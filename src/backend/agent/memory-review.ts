import { randomUUID } from "node:crypto";
import {
  type AgentModelOption,
  type AgentSummary,
  type ConversationMessage,
  defaultProviderModel,
  isContextResetMarker,
} from "@openbot/contracts/ipc";
import { createOpenBotLogger } from "@openbot/logging";
import { Effect, Exit, Fiber, Schema, Scope } from "effect";
import type { AgentClient } from "../agent-client";
import { extractJsonObject } from "../structured-output";
import type { AgentMemories } from "./agent-memories";
import { memoryChangesMessage } from "./memory-changes-message";
import { MemoryReviewResult, memoryReviewPrompt } from "./memory-review-prompt";
import type { ProfileClients } from "./profile-clients";
import { type GenerationObserver, GenerationUsageLimitError, generateTextWithoutTools } from "./profile-generation";
import type { ProviderOperationFailed } from "./provider-runtime";
import { ruleKey, ruleProposalMessage } from "./rule-proposal-message";
import { inputPrice } from "./usage-pricing";

const logger = createOpenBotLogger("memory-review");

/** The completed turns of one conversation between two reviews, by default. */
const MEMORY_REVIEW_INTERVAL = 20;
/** A conversation with no turn for this long gets its review early, when it has enough new turns. */
const MEMORY_REVIEW_IDLE_MS = 15 * 60_000;
/** The fewest new turns for a review after a pause or when a side thread closes. */
const MEMORY_REVIEW_IDLE_TURNS = 3;
/** The latest chat messages that a review reads when the chat is not loaded. */
export const MEMORY_REVIEW_MESSAGES = 200;

/**
 * The model of a review: the provider's default model when its known price is lower than the agent's
 * model, so an agent on a large model reviews at the small model's price. A model with no known
 * price stays as it is. Null when the agent's own model is not available.
 */
function reviewModel(agent: AgentSummary, models: readonly AgentModelOption[]): AgentModelOption | null {
  const listed = (id: string) => models.find((model) => model.provider === agent.provider && model.id === id);
  const own = listed(agent.model);
  if (!own) return null;
  const smaller = listed(defaultProviderModel(agent.provider));
  if (!smaller || smaller.id === own.id) return own;
  const ownPrice = inputPrice(agent.provider, own.id);
  const smallerPrice = inputPrice(agent.provider, smaller.id);
  return ownPrice !== null && smallerPrice !== null && smallerPrice < ownPrice ? smaller : own;
}

class MemoryReviewFailed extends Schema.TaggedError<MemoryReviewFailed>()("MemoryReviewFailed", {
  cause: Schema.Defect(),
}) {}

export interface MemoryReviewOptions {
  memories: AgentMemories;
  profileClients: ProfileClients;
  listAgents(): AgentSummary[];
  /** The models that the agent's provider lists once it is ready. */
  models(agent: AgentSummary): Effect.Effect<readonly AgentModelOption[], ProviderOperationFailed>;
  /** A client signed in to the agent's own provider account. */
  createProfileClient(agent: AgentSummary): AgentClient;
  /** Records the token usage of one review under its agent. */
  usageObserver(agent: AgentSummary, model: AgentModelOption): GenerationObserver;
  /** The latest messages of the agent's own chat, or of its side thread, oldest first. */
  chat(agentId: string, threadId: string | null): readonly ConversationMessage[];
  /** Whether a turn of the conversation runs and holds its cached snapshot. */
  turnActive(agentId: string, threadId: string | null): boolean;
  appendSystemMessage(agentId: string, threadId: string | null, message: ConversationMessage): void;
  /** The learned rules in the agent's instruction file. A review does not suggest them again. */
  learnedRules(agent: AgentSummary): Effect.Effect<readonly string[], unknown>;
  redact(text: string): string;
  stopping(): boolean;
  /** The pause before an early review. Omitted, `MEMORY_REVIEW_IDLE_MS`. */
  idleMs?: number;
  /**
   * The app setting: the completed turns between two reviews, read at each use. `0` turns off all
   * reviews, also after a pause, a clear and a closed side thread. Omitted, `MEMORY_REVIEW_INTERVAL`.
   */
  interval?(): number;
}

/** One conversation that a review reads: the agent's own chat (`threadId` null) or one side thread. */
interface ReviewedConversation {
  readonly key: string;
  readonly agentId: string;
  readonly threadId: string | null;
  turns: number;
  /** The last message that a review read. */
  cursor: string | null;
  /** A review's lines that wait for the running turn to end, so the turn does not write over them. */
  heldLines: ConversationMessage[];
  idle: Fiber.Fiber<void> | null;
  /** A review was due while another review ran or no profile client was free: it runs next. */
  waiting: boolean;
}

/**
 * Owns the background memory reviews: every few completed turns of an agent's
 * own chat or side thread, after a pause in it, when the chat is cleared and when a side thread
 * closes, one generation without tools reads the new part of the conversation and the agent's
 * memories, and proposes changes that `AgentMemories` applies with the checks of the memory tools.
 * The same generation can suggest rules for the agent's instruction file: each one is a line in the
 * agent's own chat that the user accepts or dismisses.
 * One review runs at a time, and only when a profile client stays free for the user. A review that
 * cannot start waits, and starts when the running review ends or at the next turn. The counts live
 * in memory only.
 *
 * It never imports the agent service facade.
 */
export class MemoryReview {
  readonly #options: MemoryReviewOptions;
  readonly #conversations = new Map<string, ReviewedConversation>();
  #running: { key: string; agentId: string; fiber: Fiber.Fiber<void> } | null = null;
  #scope = Scope.makeUnsafe();

  constructor(options: MemoryReviewOptions) {
    this.#options = options;
  }

  /**
   * A turn of the agent's own chat (`threadId` null) or of its side thread ended. A completed turn
   * that counts brings the next review closer. A turn in which the agent changed its memories itself
   * starts the count again, and the next review still reads it.
   */
  readonly turnEnded = Effect.fn("MemoryReview.turnEnded")(function* (
    this: MemoryReview,
    agentId: string,
    threadId: string | null,
    counts: boolean,
    memoryCommitted: boolean,
  ) {
    const conversation = this.#conversation(agentId, threadId);
    yield* this.#stopIdle(conversation);
    this.#flush(conversation);
    if (counts && memoryCommitted) {
      // The turns stay unread: a later review still learns lessons from them, often a correction that
      // the agent saved as a memory. That review sees the saved memory and does not add it again.
      conversation.turns = 0;
      return;
    }
    if (counts) conversation.turns += 1;
    if (conversation.turns >= this.#interval()) yield* this.#start(conversation);
    yield* this.#startWaiting();
    // A review that could not start now runs after a pause instead.
    yield* this.#startIdle(conversation);
  }).bind(this);

  /** The agent's chat was cleared: the chat that the clear ended gets its review now. */
  readonly chatCleared = Effect.fn("MemoryReview.chatCleared")(function* (this: MemoryReview, agentId: string) {
    const conversation = this.#conversation(agentId, null);
    yield* this.#stopIdle(conversation);
    this.#flush(conversation);
    yield* this.#start(conversation);
  }).bind(this);

  /** A side thread closed: its new turns get their review now. */
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

  /** Ends the side thread's review and forgets its counts, before the thread is deleted. */
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
  }).bind(this);

  /** Ends the agent's reviews and forgets its counts, before the agent is deleted. */
  readonly cancel = Effect.fn("MemoryReview.cancel")(function* (this: MemoryReview, agentId: string) {
    for (const conversation of [...this.#conversations.values()]) {
      if (conversation.agentId !== agentId) continue;
      this.#conversations.delete(conversation.key);
      yield* this.#stopIdle(conversation);
    }
    const running = this.#running;
    if (running?.agentId === agentId) yield* Fiber.interrupt(running.fiber);
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

  /** Off, the turns still count, so a review after the user turns it on again reads them. */
  #off(): boolean {
    return this.#interval() <= 0;
  }

  #conversation(agentId: string, threadId: string | null): ReviewedConversation {
    const key = conversationKey(agentId, threadId);
    const known = this.#conversations.get(key);
    if (known) return known;
    const conversation = { key, agentId, threadId, turns: 0, cursor: null, heldLines: [], idle: null, waiting: false };
    this.#conversations.set(key, conversation);
    return conversation;
  }

  readonly #stopIdle = Effect.fn("MemoryReview.stopIdle")(function* (
    this: MemoryReview,
    conversation: ReviewedConversation,
  ) {
    const idle = conversation.idle;
    conversation.idle = null;
    if (idle) yield* Fiber.interrupt(idle);
  }).bind(this);

  /** After a pause with no turn, a conversation with enough new turns gets its review. */
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
          // A usage limit belongs to the user's own turns: the review does not mark the model.
          if (failure.cause instanceof GenerationUsageLimitError) return;
          logger.warn("Could not review the agent's memories.", { error: failure.cause });
        }),
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

  /**
   * Starts the first review that waits. A clear's review that waits reads the chat after the clear
   * when new turns came first: it usually starts within seconds, before the next turn.
   */
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
      // The count starts again also when the review fails, so a failing model is not asked each turn.
      const before = { turns: conversation.turns, cursor: conversation.cursor };
      conversation.turns = 0;
      const excerpt = reviewExcerpt(messages, conversation.cursor);
      this.#moveCursor(conversation, messages);
      if (!excerpt.some((message) => message.author === "user")) return;
      const agent = options.listAgents().find((candidate) => candidate.id === agentId);
      if (!agent) return;
      const model = reviewModel(agent, yield* options.models(agent));
      if (!model || options.stopping()) return;
      if (!options.profileClients.hasSpare()) {
        // A user turn took the spare client while the model list loaded: wait, and read these turns then.
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
      // The model sees only the redacted text of these, so it must not write or forget them.
      const hidden = new Set(
        redacted
          .filter((entry, index) => entry.memory.text !== base.memories[index]?.memory.text)
          .map((entry) => entry.memory.id),
      );
      // Rules the user has or saw are not suggested again. A file that cannot be read has none.
      const learned = yield* options.learnedRules(agent).pipe(Effect.orElseSucceed((): readonly string[] => []));
      // Suggested rules always go to the agent's own chat, where the user answers them.
      const ownChat =
        threadId === null
          ? messages
          : yield* Effect.try(() => options.chat(agentId, null)).pipe(Effect.orElseSucceed(() => []));
      const proposals = ownChat.flatMap((message) => (message.ruleProposal ? [message.ruleProposal] : []));
      const proposed = (status: "proposed" | "dismissed") =>
        proposals.filter((proposal) => proposal.status === status).map((proposal) => options.redact(proposal.rule));
      const prompt = memoryReviewPrompt(
        agent,
        { ...base, memories: redacted },
        excerpt.map((message) => ({ ...message, text: options.redact(message.text) })),
        { learned: learned.map(options.redact), suggested: proposed("proposed"), dismissed: proposed("dismissed") },
      );
      const client = yield* Effect.try(() => options.createProfileClient(agent));
      const answer = yield* options.profileClients.run(client, (cancelled) =>
        generateTextWithoutTools(
          client,
          model.id === agent.model ? { ...model, defaultReasoningEffort: agent.reasoningEffort } : model,
          prompt,
          cancelled,
          options.usageObserver(agent, model),
        ),
      );
      const result = yield* Effect.try(() => extractJsonObject(answer)).pipe(
        Effect.flatMap(Schema.decodeUnknownEffect(MemoryReviewResult)),
      );
      const operations = result.operations.filter(
        (operation) => operation.type === "add" || !hidden.has(operation.memoryId),
      );
      const known = new Set([...learned, ...proposals.map((proposal) => proposal.rule)].map(ruleKey));
      const lessons = (result.lessons ?? []).filter((lesson) => {
        const key = ruleKey(lesson.rule);
        if (known.has(key)) return false;
        known.add(key);
        return true;
      });
      if ((operations.length === 0 && lessons.length === 0) || options.stopping()) return;
      if (!options.listAgents().some((candidate) => candidate.id === agentId)) return;
      const turnId = `memory-review-${randomUUID()}`;
      const changes =
        operations.length === 0
          ? []
          : yield* Effect.try(() => options.memories.applyReview(agentId, base, operations, turnId));
      const memoryLine = memoryChangesMessage(turnId, changes, options.redact);
      if (memoryLine) yield* this.#show(conversation, memoryLine);
      const own = this.#conversation(agentId, null);
      for (const [index, lesson] of lessons.entries()) {
        const line = ruleProposalMessage(turnId, index, {
          rule: options.redact(lesson.rule),
          reason: options.redact(lesson.reason),
        });
        yield* this.#show(own, line);
      }
    },
    Effect.mapError((failure) => new MemoryReviewFailed({ cause: failure })),
  ).bind(this);

  /** Adds a review's line to the conversation now, or after its running turn ends. */
  readonly #show = Effect.fn("MemoryReview.show")(function* (
    this: MemoryReview,
    conversation: ReviewedConversation,
    line: ConversationMessage,
  ) {
    if (this.#options.turnActive(conversation.agentId, conversation.threadId)) conversation.heldLines.push(line);
    else yield* Effect.try(() => this.#options.appendSystemMessage(conversation.agentId, conversation.threadId, line));
  }).bind(this);

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

function conversationKey(agentId: string, threadId: string | null): string {
  return threadId === null ? agentId : `${agentId}\u0000${threadId}`;
}

/**
 * The part of the chat that a review reads: after the last reviewed message and after the last clear
 * of the context. A clear that just happened is passed over, so its review reads the chat it ended.
 * After a restart the cursor is gone, and the review reads the latest messages.
 */
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
