import type { AgentEvent, ConversationMessage } from "@openbot/contracts/ipc";
import { CONVERSATION_PLAN_ITEM_TYPE, MESSAGING_LIMITS } from "@openbot/contracts/ipc";
import { sourceText } from "@openbot/i18n/source";
import { Deferred, Effect, Schema, type Scope } from "effect";
import { causeHelpers } from "../effect-boundary";
import type { DeliveryContext, MailboxStore, MessagingOrigin } from "../mailbox-store";
import type { OpenBotDatabase } from "../openbot-database";
import { type MessagingContextMessage, messagingPromptText } from "./messaging-prompt";
import type { MessagingOperationFailed } from "./messaging-service";
import { type MessagingLink, MessagingStore } from "./messaging-store";

/** A file the agent attached to its answer, ready to upload. */
export interface MessagingAnswerFile {
  name: string;
  path: string;
  mimeType: string;
}

type MessagingTurnStatus = "completed" | "failed" | "interrupted";

/**
 * `followUp` marks a turn that a teammate's answer started, not an external message: its answer goes
 * to the conversation, and the external message it follows up keeps its reactions.
 */
export type MessagingActivity =
  | { type: "started"; link: MessagingLink; turnId: string; origin: MessagingOrigin | null; followUp: boolean }
  | {
      type: "finished";
      link: MessagingLink;
      /** Null when the delivery failed before a turn started. */
      turnId: string | null;
      status: MessagingTurnStatus;
      origin: MessagingOrigin | null;
      followUp: boolean;
      answer: string | null;
      files: MessagingAnswerFile[];
    }
  | { type: "cancelled"; link: MessagingLink; origin: MessagingOrigin };

export interface MessagingReceiveInput {
  connectionId: string;
  agentId: string;
  platformChannelId: string;
  threadKey: string;
  isDirect: boolean;
  title: string;
  text: string;
  sourcePaths: string[];
  origin: Omit<MessagingOrigin, "linkId">;
  /** Stable for one external message, so a redelivered event enqueues nothing. */
  idempotencyKey: string;
}

export type MessagingReceiveResult =
  | { status: "queued"; link: MessagingLink; deliveryId: string; waiting: boolean }
  | { status: "duplicate" }
  | { status: "busy"; link: MessagingLink };

/** What the platform side adds to the prompt when a delivery starts. */
export interface MessagingPromptContext {
  workspaceName: string | null;
  place: string;
  messages: MessagingContextMessage[];
  /** The newest message the agent has now read, stored as the link's history cursor. */
  cursor: string | null;
  skippedFiles: string[];
}

export interface MessagingThreadsHooks {
  schedule(agentId: string): void;
  queueChanged(agentId: string): void;
  busy(agentId: string): boolean;
  interrupt(agentId: string, turnId: string, threadId: string): Effect.Effect<void, MessagingThreadFailed>;
  /** Removes live provider state for an execution thread before its rows are deleted. */
  forgetThread(threadId: string): Effect.Effect<void, MessagingThreadFailed>;
}

/**
 * Enough work from one conversation platform to hold an agent for a long time. The Slack
 * orchestrator receives every new conversation, and it mostly asks teammates, so its turns are short.
 */
const AGENT_QUEUE_LIMIT = 20;
const AUTHOR_QUEUE_LIMIT = 2;
const CONTEXT_TIMEOUT_MS = 5_000;

/**
 * Owns the execution threads of external conversations: it enqueues their messages, frames their
 * prompts, keeps their conversation events out of the agent's public chat, and reports each turn to
 * the platform side. It never talks to a platform itself. The platform side supplies the prompt
 * context through `setContextSource` and listens with `onActivity`.
 */
export class MessagingThreads {
  readonly store: MessagingStore;
  readonly #database: OpenBotDatabase;
  readonly #mailbox: MailboxStore;
  readonly #hooks: MessagingThreadsHooks;
  readonly #listeners = new Set<(activity: MessagingActivity) => void>();
  readonly #admissions = new Map<string, Deferred.Deferred<void>>();
  /** The external message each running turn answers, by turn id. */
  readonly #turnOrigins = new Map<string, { origin: MessagingOrigin | null; followUp: boolean }>();
  #contextSource:
    | ((
        link: MessagingLink,
        origin: MessagingOrigin,
      ) => Effect.Effect<MessagingPromptContext, MessagingOperationFailed>)
    | null = null;

  constructor(database: OpenBotDatabase, mailbox: MailboxStore, hooks: MessagingThreadsHooks) {
    this.store = new MessagingStore(database);
    this.#database = database;
    this.#mailbox = mailbox;
    this.#hooks = hooks;
  }

  onActivity(listener: (activity: MessagingActivity) => void): () => void {
    this.#listeners.add(listener);
    return () => this.#listeners.delete(listener);
  }

  setContextSource(
    source:
      | ((
          link: MessagingLink,
          origin: MessagingOrigin,
        ) => Effect.Effect<MessagingPromptContext, MessagingOperationFailed>)
      | null,
  ): void {
    this.#contextSource = source;
  }

  readonly receive = Effect.fn("MessagingThreads.receive")(function* (
    this: MessagingThreads,
    input: MessagingReceiveInput,
  ): Effect.fn.Return<MessagingReceiveResult, MessagingThreadFailed> {
    if (this.#mailbox.deliveryForKey(input.idempotencyKey)) return { status: "duplicate" };
    const link = this.store.ensureLink({
      connectionId: input.connectionId,
      agentId: input.agentId,
      platformChannelId: input.platformChannelId,
      threadKey: input.threadKey,
      isDirect: input.isDirect,
      title: input.title.slice(0, MESSAGING_LIMITS.name),
    });
    // The link decides the agent: a conversation that already has one keeps it, even when another
    // message routed it elsewhere at the same time.
    const agentId = link.agentId;
    // One admission at a time for each agent: the enqueue awaits file copies, and the queue limits
    // must count the requests before it.
    const previous = this.#admissions.get(agentId);
    const completed = Deferred.makeUnsafe<void>();
    this.#admissions.set(agentId, completed);
    return yield* Effect.gen({ self: this }, function* () {
      if (previous) yield* Deferred.await(previous);
      return yield* this.#admit(agentId, link, input);
    }).pipe(
      Effect.ensuring(
        Effect.sync(() => {
          Deferred.doneUnsafe(completed, Effect.void);
          if (this.#admissions.get(agentId) === completed) this.#admissions.delete(agentId);
        }),
      ),
    );
  }, Effect.uninterruptible);

  readonly #admit = Effect.fn("MessagingThreads.admit")(function* (
    this: MessagingThreads,
    agentId: string,
    link: MessagingLink,
    input: MessagingReceiveInput,
  ): Effect.fn.Return<MessagingReceiveResult, MessagingThreadFailed> {
    // Only external messages count: a teammate's answer to a request from here is the agent's own work.
    const pending = yield* threadsStep(() =>
      this.store
        .links(agentId)
        .flatMap((candidate) => this.#mailbox.unresolvedMessagingDeliveries(candidate.linkId))
        .filter((context) => context.delivery.sender.kind === "user"),
    );
    const byAuthor = pending.filter(
      (context) => this.#mailbox.messagingOrigin(context.delivery.id)?.authorId === input.origin.authorId,
    );
    if (pending.length >= AGENT_QUEUE_LIMIT || byAuthor.length >= AUTHOR_QUEUE_LIMIT) return { status: "busy", link };
    const waiting = this.#hooks.busy(agentId);
    const receipt = yield* this.#mailbox
      .enqueue({
        sender: { kind: "user" },
        messaging: { ...input.origin, linkId: link.linkId },
        recipientAgentIds: [agentId],
        text: input.text || "(The message has no text.)",
        sourcePaths: input.sourcePaths,
        idempotencyKey: input.idempotencyKey,
      })
      .pipe(toMessagingThreadFailed);
    const deliveryId = receipt.deliveries[0]?.id;
    if (!deliveryId)
      return yield* new MessagingThreadFailed({
        cause: new Error(sourceText("error.agent.queuedMessageCreateFailed")),
      });
    yield* threadsStep(() => this.store.touch(link.linkId));
    this.#hooks.schedule(agentId);
    return { status: "queued", link, deliveryId, waiting };
  });

  /** The execution thread of a messaging delivery, or null for any other delivery. */
  threadForDelivery(deliveryId: string): string | null {
    const origin = this.#mailbox.messagingOrigin(deliveryId);
    return origin ? (this.store.link(origin.linkId)?.threadId ?? null) : null;
  }

  ownsDelivery(deliveryId: string): boolean {
    return this.#mailbox.messagingOrigin(deliveryId) !== null;
  }

  readonly prepare = Effect.fn("MessagingThreads.prepare")(function* (
    this: MessagingThreads,
    context: DeliveryContext,
  ): Effect.fn.Return<{ threadId: string; text: string } | null, MessagingThreadFailed> {
    const origin = this.#mailbox.messagingOrigin(context.delivery.id);
    if (!origin) return null;
    const link = this.store.link(origin.linkId);
    if (!link) return null;
    // A teammate's answer to a request the agent sent from this conversation. The delivery framing
    // presents it as a teammate's reply, and the turn's answer is posted to the conversation.
    if (context.delivery.sender.kind === "agent") return { threadId: link.threadId, text: context.delivery.text };
    const connection = this.store.connection(link.connectionId);
    const prompt = yield* this.#promptContext(link, origin);
    if (prompt.cursor) this.store.touch(link.linkId, prompt.cursor);
    return {
      threadId: link.threadId,
      text: messagingPromptText({
        platform: connection?.platform ?? "slack",
        workspaceName: prompt.workspaceName ?? connection?.workspaceName ?? null,
        isDirect: link.isDirect,
        place: prompt.place,
        authorName: origin.authorName,
        authorId: origin.authorId,
        text: context.delivery.text,
        context: prompt.messages,
        skippedFiles: prompt.skippedFiles,
      }),
    };
  });

  /** The prompt context from the platform, or none when it is slow or fails: the message still runs. */
  readonly #promptContext = Effect.fn("MessagingThreads.promptContext")(function* (
    this: MessagingThreads,
    link: MessagingLink,
    origin: MessagingOrigin,
  ) {
    const fallback: MessagingPromptContext = {
      workspaceName: null,
      place: link.title,
      messages: [],
      cursor: null,
      skippedFiles: [],
    };
    const source = this.#contextSource;
    if (!source) return fallback;
    return yield* source(link, origin).pipe(
      Effect.timeout(CONTEXT_TIMEOUT_MS),
      Effect.catch(() => Effect.succeed(fallback)),
    );
  });

  /**
   * Takes the conversation events of a messaging thread, so the agent's public chat and the Team
   * API never see them, and reports turn starts and ends. Approvals are not taken: the host still
   * shows them.
   */
  event(event: AgentEvent, scope: Scope.Scope): boolean {
    switch (event.type) {
      case "conversation":
        return event.snapshot.threadId !== null && this.store.linkForThread(event.snapshot.threadId) !== null;
      case "conversation-delta":
      case "turn-progress":
        return this.store.linkForThread(event.threadId) !== null;
      case "turn-started": {
        const link = this.store.linkForThread(event.threadId);
        if (!link) return false;
        const running = this.#mailbox
          .unresolvedMessagingDeliveries(link.linkId)
          .find((context) => context.delivery.status !== "queued");
        const origin = running ? this.#mailbox.messagingOrigin(running.delivery.id) : null;
        const followUp = running?.delivery.sender.kind === "agent";
        this.#turnOrigins.set(event.turnId, { origin, followUp });
        this.#publish({ type: "started", link, turnId: event.turnId, origin, followUp });
        return true;
      }
      case "turn-completed": {
        const link = this.store.linkForThread(event.threadId);
        if (!link) return false;
        const started = this.#turnOrigins.get(event.turnId) ?? { origin: null, followUp: false };
        this.#turnOrigins.delete(event.turnId);
        this.store.touch(link.linkId);
        Effect.runFork(
          this.#finished(link, event.turnId, event.status, started.origin, started.followUp).pipe(
            Effect.uninterruptible,
            Effect.forkIn(scope, { startImmediately: true }),
          ),
        );
        return true;
      }
      default:
        return false;
    }
  }

  /** A messaging delivery that failed before its turn started ends like a failed turn. */
  deliveryFailed(deliveryId: string): void {
    const origin = this.#mailbox.messagingOrigin(deliveryId);
    const link = origin ? this.store.link(origin.linkId) : null;
    if (!origin || !link) return;
    const followUp = this.#mailbox.getDelivery(deliveryId)?.delivery.sender.kind === "agent";
    this.#publish({
      type: "finished",
      link,
      turnId: null,
      status: "failed",
      origin,
      followUp,
      answer: null,
      files: [],
    });
  }

  /** The requester of the turn that runs now in this link, if one runs. */
  runningOrigin(linkId: string): { turnId: string; origin: MessagingOrigin } | null {
    const running = this.#mailbox
      .unresolvedMessagingDeliveries(linkId)
      .find((context) => context.delivery.status === "running" && context.delivery.turnId);
    const origin = running ? this.#mailbox.messagingOrigin(running.delivery.id) : null;
    return running?.delivery.turnId && origin ? { turnId: running.delivery.turnId, origin } : null;
  }

  readonly stop = Effect.fn("MessagingThreads.stop")(function* (
    this: MessagingThreads,
    linkId: string,
    authorId: string,
  ): Effect.fn.Return<boolean, MessagingThreadFailed> {
    const link = this.store.link(linkId);
    if (!link) return false;
    let stopped = false;
    for (const context of this.#mailbox.unresolvedMessagingDeliveries(linkId)) {
      const origin = this.#mailbox.messagingOrigin(context.delivery.id);
      if (!origin || origin.authorId !== authorId) continue;
      if (context.delivery.status === "queued") {
        yield* this.#mailbox.cancel(link.agentId, context.delivery.id).pipe(toMessagingThreadFailed);
        this.#hooks.queueChanged(link.agentId);
        this.#publish({ type: "cancelled", link, origin });
        stopped = true;
      } else if (context.delivery.status === "running" && context.delivery.turnId) {
        const turnId = context.delivery.turnId;
        yield* this.#hooks.interrupt(link.agentId, turnId, link.threadId).pipe(toMessagingThreadFailed);
        stopped = true;
      }
    }
    if (stopped) this.#hooks.schedule(link.agentId);
    return stopped;
  });

  /** True while a teammate works on a request that the agent sent from this conversation. */
  awaitsTeammate(linkId: string): boolean {
    return this.#mailbox.pendingMessagingReturns(linkId) > 0;
  }

  readonly deleteForAgent = Effect.fn("MessagingThreads.deleteForAgent")(function* (
    this: MessagingThreads,
    agentId: string,
  ): Effect.fn.Return<void, MessagingThreadFailed> {
    for (const threadId of this.store.threadIdsForAgent(agentId))
      yield* this.#hooks.forgetThread(threadId).pipe(toMessagingThreadFailed);
    yield* threadsStep(() => this.store.deleteForAgent(agentId));
  });

  readonly #finished = Effect.fn("MessagingThreads.finished")(function* (
    this: MessagingThreads,
    link: MessagingLink,
    turnId: string,
    status: string,
    origin: MessagingOrigin | null,
    followUp: boolean,
  ): Effect.fn.Return<void, MessagingThreadFailed> {
    const messages = yield* threadsStep(() => this.#turnMessages(link, turnId));
    const answer = [...messages].reverse().find(isAnswer)?.text ?? null;
    const files: MessagingAnswerFile[] = [];
    for (const message of messages) {
      if (message.author === "user") continue;
      for (const attachment of message.attachments ?? []) {
        const resolved = yield* this.#mailbox.resolveAttachment(attachment.id).pipe(toMessagingThreadFailed);
        if (resolved) files.push(resolved);
      }
    }
    this.#publish({
      type: "finished",
      link,
      turnId,
      status: status === "completed" ? "completed" : status === "interrupted" ? "interrupted" : "failed",
      origin,
      followUp,
      answer,
      files,
    });
  });

  #turnMessages(link: MessagingLink, turnId: string): ConversationMessage[] {
    return this.#database
      .readConversation(link.agentId, link.threadId)
      .messages.filter((message) => message.turnId === turnId);
  }

  #publish(activity: MessagingActivity): void {
    for (const listener of this.#listeners) listener(activity);
  }
}

/** The same test the turn lifecycle uses for the answer of a turn. */
function isAnswer(message: ConversationMessage): boolean {
  return (
    message.author === "assistant" &&
    message.itemType !== "commentary" &&
    message.itemType !== "question_prompt" &&
    message.itemType !== CONVERSATION_PLAN_ITEM_TYPE &&
    Boolean(message.text.trim())
  );
}

export class MessagingThreadFailed extends Schema.TaggedError<MessagingThreadFailed>()("MessagingThreadFailed", {
  cause: Schema.Defect(),
}) {}

const { sync: threadsStep, rewrap: toMessagingThreadFailed } = causeHelpers(MessagingThreadFailed);

export { toMessagingThreadFailed };
