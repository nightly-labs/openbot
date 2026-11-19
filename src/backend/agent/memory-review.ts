import { randomUUID } from "node:crypto";
import {
  type AgentModelOption,
  type AgentSummary,
  type ConversationMessage,
  isContextResetMarker,
  SKILL_SUGGESTION_NAME_CHARACTERS,
  type SkillLearningMode,
  skillConversationEvent,
  skillConversationEventItemType,
  skillSuggestionItemType,
  skillSuggestionTarget,
} from "@openbot/contracts/ipc";
import { createOpenBotLogger } from "@openbot/logging";
import { Deferred, Effect, Exit, Fiber, Schema, Scope } from "effect";
import type { AgentClient } from "../agent-client";
import { extractJsonObject } from "../structured-output";
import type { UserBrowsingLog, UserBrowsingStep } from "../user-browsing-log";
import type { AgentMemories } from "./agent-memories";
import { backgroundModel, withBackgroundEffort } from "./background-model";
import { memoryChangesMessage } from "./memory-changes-message";
import { conversationKey, type MemoryReviewCursors } from "./memory-review-cursors";
import {
  acceptedSuggestion,
  MemoryReviewResult,
  memoryReviewPrompt,
  type ReviewSkill,
  type SkillReviewInput,
  SkillReviewResult,
  type SkillReviewSuggestion,
} from "./memory-review-prompt";
import type { ProfileClients } from "./profile-clients";
import { type GenerationObserver, GenerationUsageLimitError, generateTextWithoutTools } from "./profile-generation";
import type { ProviderOperationFailed } from "./provider-runtime";
import {
  type LearnedSkillDraft,
  revisionKeepsSkill,
  type SkillLearner,
  SkillWriterResult,
  skillWriterPrompt,
  writerCanRevise,
} from "./skill-learning";
import { reviewedChat, skillSuggestionMessages, skillSuggestionSaved } from "./skill-suggestion";

const logger = createOpenBotLogger("memory-review");

const MEMORY_REVIEW_INTERVAL = 20;
const MEMORY_REVIEW_IDLE_MS = 15 * 60_000;
const MEMORY_REVIEW_IDLE_TURNS = 3;
export const MEMORY_REVIEW_MESSAGES = 200;

class MemoryReviewFailed extends Schema.TaggedError<MemoryReviewFailed>()("MemoryReviewFailed", {
  cause: Schema.Defect(),
}) {}

export interface MemoryReviewOptions {
  memories: AgentMemories;
  profileClients: ProfileClients;
  listAgents(): AgentSummary[];
  models(agent: AgentSummary): Effect.Effect<readonly AgentModelOption[], ProviderOperationFailed>;
  createProfileClient(agent: AgentSummary): AgentClient;
  usageObserver(agent: AgentSummary, model: AgentModelOption): GenerationObserver;
  chat(agentId: string, threadId: string | null): readonly ConversationMessage[];
  turnActive(agentId: string, threadId: string | null): boolean;
  appendSystemMessage(agentId: string, threadId: string | null, message: ConversationMessage): void;
  skills?(agentId: string): Effect.Effect<readonly ReviewSkill[], unknown>;
  skillLearning?(): SkillLearningMode;
  skillLearner?: SkillLearner;
  redact(text: string): string;
  stopping(): boolean;
  idleMs?: number;
  interval?(): number;
  cursors?: MemoryReviewCursors;
  browsing?: Pick<UserBrowsingLog, "pending" | "reviewed" | "forgetAgent">;
}

interface ReviewedConversation {
  readonly key: string;
  readonly agentId: string;
  readonly threadId: string | null;
  turns: number;
  cursor: string | null;
  heldLines: ConversationMessage[];
  idle: Fiber.Fiber<void> | null;
  waiting: boolean;
}

export class MemoryReview {
  readonly #options: MemoryReviewOptions;
  readonly #conversations = new Map<string, ReviewedConversation>();
  #running: { key: string; agentId: string; fiber: Fiber.Fiber<void> } | null = null;
  readonly #saving = new Map<string, Deferred.Deferred<boolean>>();
  readonly #saved = new Set<string>();
  #scope = Scope.makeUnsafe();

  constructor(options: MemoryReviewOptions) {
    this.#options = options;
  }

  readonly turnEnded = Effect.fn("MemoryReview.turnEnded")(function* (
    this: MemoryReview,
    agentId: string,
    threadId: string | null,
    counts: boolean,
    memoryCommitted: boolean,
  ) {
    const conversation = yield* this.#conversation(agentId, threadId);
    yield* this.#stopIdle(conversation);
    this.#flush(conversation);
    if (counts && memoryCommitted) {
      conversation.turns = 0;
      if (this.#learnsSkills()) return;
      const messages = yield* Effect.try(() => this.#options.chat(agentId, threadId)).pipe(
        Effect.orElseSucceed(() => []),
      );
      this.#moveCursor(conversation, messages);
      yield* this.#saveCursor(conversation).pipe(Effect.forkIn(this.#scope));
      return;
    }
    if (counts) conversation.turns += 1;
    if (conversation.turns >= this.#interval()) yield* this.#start(conversation);
    yield* this.#startWaiting();
    yield* this.#startIdle(conversation);
  }).bind(this);

  readonly chatCleared = Effect.fn("MemoryReview.chatCleared")(function* (this: MemoryReview, agentId: string) {
    const conversation = yield* this.#conversation(agentId, null);
    yield* this.#stopIdle(conversation);
    this.#flush(conversation);
    yield* this.#start(conversation);
  }).bind(this);

  readonly threadClosed = Effect.fn("MemoryReview.threadClosed")(function* (
    this: MemoryReview,
    agentId: string,
    threadId: string,
  ) {
    const conversation = this.#conversations.get(conversationKey(agentId, threadId));
    if (!conversation) return;
    yield* this.#stopIdle(conversation);
    this.#flush(conversation);
    if (conversation.turns > 0) yield* this.#start(conversation);
  }).bind(this);

  readonly forgetThread = Effect.fn("MemoryReview.forgetThread")(function* (
    this: MemoryReview,
    agentId: string,
    threadId: string,
  ) {
    const key = conversationKey(agentId, threadId);
    const conversation = this.#conversations.get(key);
    this.#conversations.delete(key);
    if (conversation) yield* this.#stopIdle(conversation);
    const running = this.#running;
    if (running?.key === key) yield* Fiber.interrupt(running.fiber);
    yield* this.#options.cursors?.set(agentId, threadId, null) ?? Effect.void;
  }).bind(this);

  readonly cancel = Effect.fn("MemoryReview.cancel")(function* (this: MemoryReview, agentId: string) {
    for (const conversation of [...this.#conversations.values()]) {
      if (conversation.agentId !== agentId) continue;
      this.#conversations.delete(conversation.key);
      yield* this.#stopIdle(conversation);
    }
    const running = this.#running;
    if (running?.agentId === agentId) yield* Fiber.interrupt(running.fiber);
    yield* this.#options.cursors?.forgetAgent(agentId) ?? Effect.void;
    yield* this.#options.browsing?.forgetAgent(agentId) ?? Effect.void;
  }).bind(this);

  readonly saveSuggestion = Effect.fn("MemoryReview.saveSuggestion")(function* (
    this: MemoryReview,
    agentId: string,
    threadId: string | null,
    messageId: string,
  ) {
    const key = `${conversationKey(agentId, threadId)}:${messageId}`;
    const running = this.#saving.get(key);
    if (running) return yield* Deferred.await(running);
    if (this.#saved.has(key)) return true;
    const ended = Deferred.makeUnsafe<boolean>();
    this.#saving.set(key, ended);
    return yield* this.#saveSuggestion(agentId, threadId, messageId, () => this.#saved.add(key)).pipe(
      Effect.onExit((exit) =>
        Effect.sync(() => {
          this.#saving.delete(key);
          Deferred.doneUnsafe(ended, Effect.succeed(Exit.isSuccess(exit) && exit.value));
        }),
      ),
    );
  }).bind(this);

  readonly #saveSuggestion = Effect.fn("MemoryReview.saveSuggestionOnce")(function* (
    this: MemoryReview,
    agentId: string,
    threadId: string | null,
    messageId: string,
    saved: () => void,
  ) {
    const options = this.#options;
    const messages = yield* Effect.try(() => options.chat(agentId, threadId)).pipe(Effect.orElseSucceed(() => []));
    const index = messages.findIndex((message) => message.id === messageId);
    const message = messages[index];
    const target = message ? skillSuggestionTarget(message) : null;
    const name = message?.skillSuggestion?.name;
    if (!message || !target || !name) return false;
    if (skillSuggestionSaved(messages, index)) return true;
    const agent = options.listAgents().find((candidate) => candidate.id === agentId);
    if (!agent || options.stopping()) return false;
    const model = backgroundModel(agent, yield* options.models(agent).pipe(Effect.orElseSucceed(() => [])));
    if (!model) return false;
    const suggestion: SkillReviewSuggestion = {
      ...target,
      name,
      message: message.text,
    };
    const turnId = `${REVIEW_TURN_PREFIX}${randomUUID()}`;
    const line = yield* this.#learn(agent, model, suggestion, reviewedChat(messages, index), turnId, true);
    if (!line) return false;
    saved();
    const conversation = yield* this.#conversation(agentId, threadId);
    if (options.turnActive(agentId, threadId)) conversation.heldLines.push(line);
    else
      yield* Effect.try(() => options.appendSystemMessage(agentId, threadId, line)).pipe(
        Effect.catchCause((cause) =>
          Effect.sync(() => logger.warn("Could not show the saved skill in the chat.", { error: cause })),
        ),
      );
    return true;
  }).bind(this);

  readonly dispose = Effect.fn("MemoryReview.dispose")(function* (this: MemoryReview) {
    yield* Scope.close(this.#scope, Exit.void);
    this.#scope = Scope.makeUnsafe();
    this.#running = null;
    this.#conversations.clear();
  }).bind(this);

  #interval(): number {
    return this.#options.interval?.() ?? MEMORY_REVIEW_INTERVAL;
  }

  running(): boolean {
    return !this.#off();
  }

  #learnsSkills(): boolean {
    return this.#options.skills !== undefined && (this.#options.skillLearning?.() ?? "ask") !== "off";
  }

  #off(): boolean {
    return this.#interval() <= 0;
  }

  readonly #conversation = Effect.fn("MemoryReview.conversation")(function* (
    this: MemoryReview,
    agentId: string,
    threadId: string | null,
  ) {
    const key = conversationKey(agentId, threadId);
    const known = this.#conversations.get(key);
    if (known) return known;
    const cursors = this.#options.cursors;
    if (cursors) yield* cursors.load();
    const added = this.#conversations.get(key);
    if (added) return added;
    const conversation: ReviewedConversation = {
      key,
      agentId,
      threadId,
      turns: 0,
      cursor: cursors?.get(agentId, threadId) ?? null,
      heldLines: [],
      idle: null,
      waiting: false,
    };
    this.#conversations.set(key, conversation);
    return conversation;
  }).bind(this);

  #saveCursor(conversation: ReviewedConversation): Effect.Effect<void> {
    if (this.#conversations.get(conversation.key) !== conversation) return Effect.void;
    return this.#options.cursors?.set(conversation.agentId, conversation.threadId, conversation.cursor) ?? Effect.void;
  }

  readonly #stopIdle = Effect.fn("MemoryReview.stopIdle")(function* (
    this: MemoryReview,
    conversation: ReviewedConversation,
  ) {
    const idle = conversation.idle;
    conversation.idle = null;
    if (idle) yield* Fiber.interrupt(idle);
  }).bind(this);

  readonly #startIdle = Effect.fn("MemoryReview.startIdle")(function* (
    this: MemoryReview,
    conversation: ReviewedConversation,
  ) {
    if (conversation.turns < MEMORY_REVIEW_IDLE_TURNS || this.#off() || this.#options.stopping()) return;
    conversation.idle = yield* Effect.sleep(this.#options.idleMs ?? MEMORY_REVIEW_IDLE_MS).pipe(
      Effect.andThen(
        Effect.suspend(() => {
          conversation.idle = null;
          if (this.#conversations.get(conversation.key) !== conversation) return Effect.void;
          if (conversation.turns < MEMORY_REVIEW_IDLE_TURNS) return Effect.void;
          if (this.#options.turnActive(conversation.agentId, conversation.threadId)) return Effect.void;
          return this.#start(conversation);
        }),
      ),
      Effect.forkIn(this.#scope),
    );
  }).bind(this);

  readonly #start = Effect.fn("MemoryReview.start")(function* (
    this: MemoryReview,
    conversation: ReviewedConversation,
  ): Effect.fn.Return<void> {
    if (this.#off() || this.#options.stopping()) return;
    if (this.#running || !this.#options.profileClients.hasSpare()) {
      conversation.waiting = true;
      return;
    }
    conversation.waiting = false;
    const fiber = yield* this.#review(conversation).pipe(
      Effect.catch((failure) =>
        Effect.sync(() => {
          if (failure.cause instanceof GenerationUsageLimitError) return;
          logger.warn("Could not review the agent's memories.", { error: failure.cause });
        }).pipe(Effect.andThen(this.#saveCursor(conversation))),
      ),
      Effect.ensuring(
        Effect.suspend(() => {
          if (this.#running?.key === conversation.key) this.#running = null;
          return this.#startWaiting();
        }),
      ),
      Effect.forkIn(this.#scope),
    );
    this.#running = { key: conversation.key, agentId: conversation.agentId, fiber };
  }).bind(this);

  readonly #startWaiting = Effect.fn("MemoryReview.startWaiting")(function* (
    this: MemoryReview,
  ): Effect.fn.Return<void> {
    if (this.#running) return;
    for (const conversation of this.#conversations.values()) {
      if (!conversation.waiting) continue;
      yield* this.#start(conversation);
      return;
    }
  }).bind(this);

  readonly #review = Effect.fn("MemoryReview.review")(
    function* (this: MemoryReview, conversation: ReviewedConversation) {
      const options = this.#options;
      const { agentId, threadId } = conversation;
      const messages = yield* Effect.try(() => options.chat(agentId, threadId));
      const before = { turns: conversation.turns, cursor: conversation.cursor };
      conversation.turns = 0;
      const excerpt = reviewExcerpt(messages, conversation.cursor);
      this.#moveCursor(conversation, messages);
      if (!excerpt.some((message) => message.author === "user")) return yield* this.#saveCursor(conversation);
      const agent = options.listAgents().find((candidate) => candidate.id === agentId);
      if (!agent || options.stopping()) return;
      const model = backgroundModel(agent, yield* options.models(agent));
      if (options.stopping()) return;
      if (!model) return yield* this.#saveCursor(conversation);
      if (!options.profileClients.hasSpare()) {
        conversation.turns += before.turns;
        conversation.cursor = before.cursor;
        conversation.waiting = true;
        return;
      }
      const base = yield* Effect.try(() => options.memories.reviewBase(agentId));
      const redacted = base.memories.map((entry) => ({
        ...entry,
        memory: { ...entry.memory, text: options.redact(entry.memory.text) },
      }));
      const hidden = new Set(
        redacted
          .filter((entry, index) => entry.memory.text !== base.memories[index]?.memory.text)
          .map((entry) => entry.memory.id),
      );
      const skillInput = yield* this.#skillInput(agentId, messages);
      const browsing = options.browsing ? yield* options.browsing.pending(agentId) : [];
      const prompt = memoryReviewPrompt(
        agent,
        { ...base, memories: redacted },
        excerpt.map((message) => redactedMessage(message, options.redact)),
        skillInput ?? undefined,
        browsing.map((step) => redactedStep(step, options.redact)),
      );
      const client = yield* Effect.try(() => options.createProfileClient(agent));
      const answer = yield* options.profileClients.run(client, (cancelled) =>
        generateTextWithoutTools(
          client,
          withBackgroundEffort(model),
          prompt,
          cancelled,
          options.usageObserver(agent, model),
        ),
      );
      const json = yield* Effect.try(() => extractJsonObject(answer));
      const result = yield* Schema.decodeUnknownEffect(MemoryReviewResult)(json);
      const lastStep = browsing.at(-1);
      if (lastStep) yield* options.browsing?.reviewed(agentId, lastStep.at) ?? Effect.void;
      const operations = result.operations.filter(
        (operation) => operation.type === "add" || !hidden.has(operation.memoryId),
      );
      const suggestion = skillInput
        ? yield* Schema.decodeUnknownEffect(SkillReviewResult)(json).pipe(
            Effect.map(({ skill }) => acceptedSuggestion(skill, skillInput.skills)),
            Effect.map((accepted) =>
              accepted?.action === "update" &&
              excerpt.some(
                (message) =>
                  !isReviewTurn(message.turnId) && skillConversationEvent(message)?.skillId === accepted.skillId,
              )
                ? null
                : accepted,
            ),
            Effect.orElseSucceed(() => null),
          )
        : null;
      if (options.stopping()) return;
      if (operations.length === 0 && !suggestion) return yield* this.#saveCursor(conversation);
      if (!options.listAgents().some((candidate) => candidate.id === agentId)) return;
      const turnId = `${REVIEW_TURN_PREFIX}${randomUUID()}`;
      const changes =
        operations.length === 0
          ? []
          : yield* Effect.try(() => options.memories.applyReview(agentId, base, operations, turnId));
      yield* this.#saveCursor(conversation);
      const learned =
        suggestion && skillInput?.automatic
          ? yield* this.#learn(agent, model, suggestion, excerpt, turnId, false)
          : null;
      const lines = [
        memoryChangesMessage(turnId, changes, options.redact),
        learned ?? (suggestion && skillSuggestionMessage(turnId, suggestion, options.redact)),
      ].filter((line): line is ConversationMessage => line !== null);
      if (options.turnActive(agentId, threadId)) conversation.heldLines.push(...lines);
      else for (const line of lines) yield* Effect.try(() => options.appendSystemMessage(agentId, threadId, line));
    },
    Effect.mapError((failure) => new MemoryReviewFailed({ cause: failure })),
  ).bind(this);

  #skillInput(agentId: string, messages: readonly ConversationMessage[]): Effect.Effect<SkillReviewInput | null> {
    const { skills, redact, skillLearner } = this.#options;
    const mode = this.#options.skillLearning?.() ?? "ask";
    if (!skills || mode === "off") return Effect.succeed(null);
    return Effect.suspend(() => skills(agentId)).pipe(
      Effect.map(
        (list): SkillReviewInput => ({
          skills: list.map((skill) => ({
            skillId: skill.skillId,
            name: redact(skill.name),
            description: skill.description === undefined ? undefined : redact(skill.description),
          })),
          earlierSuggestions: earlierSkillLines(messages).map(redact),
          automatic: mode === "automatic" && skillLearner !== undefined,
        }),
      ),
      Effect.catchCause((cause) =>
        Effect.sync(() => {
          logger.warn("Could not list the agent's skills for its memory review.", { error: cause });
          return null;
        }),
      ),
    );
  }

  #learn(
    agent: AgentSummary,
    model: AgentModelOption,
    suggestion: SkillReviewSuggestion,
    excerpt: readonly ConversationMessage[],
    turnId: string,
    userAsked: boolean,
  ): Effect.Effect<ConversationMessage | null> {
    const options = this.#options;
    const learner = options.skillLearner;
    if (!learner) return Effect.succeed(null);
    return Effect.gen(function* () {
      const skillId = suggestion.action === "update" ? suggestion.skillId : undefined;
      const current = skillId ? yield* learner.read(skillId) : undefined;
      const shown = current && {
        ...current,
        description: options.redact(current.description),
        instructions: options.redact(current.instructions),
      };
      if (shown && (shown.description !== current.description || shown.instructions !== current.instructions))
        return yield* Effect.fail(new Error("The skill holds redacted text, so the review does not rewrite it."));
      if (current && !writerCanRevise(current))
        return yield* Effect.fail(
          new Error("The skill is too long to write again, so the review does not rewrite it."),
        );
      const free = userAsked ? !options.profileClients.busy() : options.profileClients.hasSpare();
      if (!free || options.stopping()) return null;
      const prompt = skillWriterPrompt(
        agent,
        suggestion,
        excerpt.map((message) => redactedMessage(message, options.redact)),
        shown,
      );
      const client = yield* Effect.try(() => options.createProfileClient(agent));
      const answer = yield* options.profileClients.run(client, (cancelled) =>
        generateTextWithoutTools(
          client,
          withBackgroundEffort(model),
          prompt,
          cancelled,
          options.usageObserver(agent, model),
        ),
      );
      const written = yield* Schema.decodeUnknownEffect(SkillWriterResult)(
        yield* Effect.try(() => extractJsonObject(answer)),
      );
      if (current && !revisionKeepsSkill(current, written.instructions))
        return yield* Effect.fail(
          new Error("The revision drops text or letters of the skill, so the review does not save it."),
        );
      if (options.stopping()) return null;
      const draft: LearnedSkillDraft =
        skillId && current
          ? {
              action: "update",
              skillId,
              expectedRevision: current.revision,
              description: options.redact(written.description),
              instructions: options.redact(written.instructions),
            }
          : {
              action: "create",
              name: options.redact(suggestion.name),
              description: options.redact(written.description),
              instructions: options.redact(written.instructions),
            };
      const event = yield* learner.save(agent.id, draft);
      const line: ConversationMessage = {
        id: `${turnId}:skill-${event.action}`,
        turnId,
        author: "system",
        source: "system",
        status: "completed",
        createdAt: new Date().toISOString(),
        itemType: skillConversationEventItemType(event),
        text: options.redact(event.skillName),
      };
      return line;
    }).pipe(
      Effect.catchCause((cause) =>
        Effect.sync(() => {
          logger.warn("Could not save the skill that the memory review found. The user can still agree in the chat.", {
            error: cause,
          });
          return null;
        }),
      ),
    );
  }

  #moveCursor(conversation: ReviewedConversation, messages: readonly ConversationMessage[]): void {
    const last = messages.at(-1);
    if (last) conversation.cursor = last.id;
  }

  #flush(conversation: ReviewedConversation): void {
    const lines = conversation.heldLines;
    if (lines.length === 0 || this.#options.turnActive(conversation.agentId, conversation.threadId)) return;
    conversation.heldLines = [];
    for (const line of lines) {
      try {
        this.#options.appendSystemMessage(conversation.agentId, conversation.threadId, line);
      } catch (error) {
        logger.warn("Could not show the memory review's changes.", { error });
      }
    }
  }
}

function redactedStep(step: UserBrowsingStep, redact: (text: string) => string): UserBrowsingStep {
  return {
    ...step,
    path: redact(step.path),
    ...(step.title === undefined ? {} : { title: redact(step.title) }),
    ...(step.name === undefined ? {} : { name: redact(step.name) }),
  };
}

function redactedMessage(message: ConversationMessage, redact: (text: string) => string): ConversationMessage {
  const trace = message.trace;
  return {
    ...message,
    text: redact(message.text),
    ...(trace
      ? {
          trace: {
            ...trace,
            steps: trace.steps.map((step) => ({
              ...step,
              ...(step.text === undefined ? {} : { text: redact(step.text) }),
              ...(step.command === undefined ? {} : { command: redact(step.command) }),
              ...(step.error === undefined ? {} : { error: redact(step.error) }),
            })),
          },
        }
      : {}),
  };
}

function earlierSkillLines(messages: readonly ConversationMessage[]): string[] {
  const suggestions = new Set(skillSuggestionMessages(messages));
  return messages.flatMap((message) => {
    if (suggestions.has(message)) return [message.text];
    const event = skillConversationEvent(message);
    return event && event.action !== "installed" ? [`Saved a change to the skill "${event.skillName}".`] : [];
  });
}

function skillSuggestionMessage(
  turnId: string,
  suggestion: SkillReviewSuggestion,
  redact: (text: string) => string,
): ConversationMessage {
  return {
    id: `${turnId}:skill-suggestion`,
    turnId,
    author: "system",
    source: "system",
    status: "completed",
    createdAt: new Date().toISOString(),
    itemType: skillSuggestionItemType(
      suggestion.action === "update" && suggestion.skillId
        ? { action: "update", skillId: suggestion.skillId }
        : { action: "create" },
    ),
    text: redact(suggestion.message),
    skillSuggestion: { name: redact(suggestion.name).slice(0, SKILL_SUGGESTION_NAME_CHARACTERS) },
  };
}

const REVIEW_TURN_PREFIX = "memory-review-";

function isReviewTurn(turnId: string | undefined): boolean {
  return turnId?.startsWith(REVIEW_TURN_PREFIX) === true;
}

function reviewExcerpt(messages: readonly ConversationMessage[], cursor: string | null) {
  let end = messages.length;
  while (end > 0) {
    const message = messages[end - 1];
    if (!message || !isContextResetMarker(message)) break;
    end -= 1;
  }
  let start = 0;
  for (let index = end - 1; index >= 0; index -= 1) {
    const message = messages[index];
    if (message && (message.id === cursor || isContextResetMarker(message))) {
      start = index + 1;
      break;
    }
  }
  return messages.slice(start, end);
}
