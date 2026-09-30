import type { AgentEvent, ConversationMessage } from "@openbot/contracts/ipc";
import { CONVERSATION_PLAN_ITEM_TYPE, MESSAGING_LIMITS } from "@openbot/contracts/ipc";
import { sourceText } from "@openbot/i18n/source";
import type { DeliveryContext, MailboxStore, MessagingOrigin } from "../mailbox-store";
import type { OpenBotDatabase } from "../openbot-database";
import { type MessagingContextMessage, messagingPromptText } from "./messaging-prompt";
import { type MessagingLink, MessagingStore } from "./messaging-store";

/** A file the agent attached to its answer, ready to upload. */
export interface MessagingAnswerFile {
  name: string;
  path: string;
  mimeType: string;
}

export type MessagingTurnStatus = "completed" | "failed" | "interrupted";

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
  busy(agentId: string): boolean;
  interrupt(agentId: string, turnId: string, threadId: string): Promise<void>;
  /** Removes live provider state for an execution thread before its rows are deleted. */
  forgetThread(threadId: string): Promise<void>;
}

/** Enough work from one conversation platform to hold an agent for a long time. */
const AGENT_QUEUE_LIMIT = 5;
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
  /** The external message each running turn answers, by turn id. */
  readonly #turnOrigins = new Map<string, { origin: MessagingOrigin | null; followUp: boolean }>();
  #contextSource: ((link: MessagingLink, origin: MessagingOrigin) => Promise<MessagingPromptContext>) | null = null;

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
    source: ((link: MessagingLink, origin: MessagingOrigin) => Promise<MessagingPromptContext>) | null,
  ): void {
    this.#contextSource = source;
  }

  async receive(input: MessagingReceiveInput): Promise<MessagingReceiveResult> {
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
    // Only external messages count: a teammate's answer to a request from here is the agent's own work.
    const pending = this.store
      .links(agentId)
      .flatMap((candidate) => this.#mailbox.unresolvedMessagingDeliveries(candidate.linkId))
      .filter((context) => context.delivery.sender.kind === "user");
    const byAuthor = pending.filter(
      (context) => this.#mailbox.messagingOrigin(context.delivery.id)?.authorId === input.origin.authorId,
    );
    if (pending.length >= AGENT_QUEUE_LIMIT || byAuthor.length >= AUTHOR_QUEUE_LIMIT) return { status: "busy", link };
    const waiting = this.#hooks.busy(agentId);
    const receipt = await this.#mailbox.enqueue({
      sender: { kind: "user" },
      messaging: { ...input.origin, linkId: link.linkId },
      recipientAgentIds: [agentId],
      text: input.text || "(The message has no text.)",
      sourcePaths: input.sourcePaths,
      idempotencyKey: input.idempotencyKey,
    });
    const deliveryId = receipt.deliveries[0]?.id;
    if (!deliveryId) throw new Error(sourceText("error.agent.queuedMessageCreateFailed"));
    this.store.touch(link.linkId);
    this.#hooks.schedule(agentId);
    return { status: "queued", link, deliveryId, waiting };
  }

  /** The execution thread of a messaging delivery, or null for any other delivery. */
  threadForDelivery(deliveryId: string): string | null {
    const origin = this.#mailbox.messagingOrigin(deliveryId);
    return origin ? (this.store.link(origin.linkId)?.threadId ?? null) : null;
  }

  ownsDelivery(deliveryId: string): boolean {
    return this.#mailbox.messagingOrigin(deliveryId) !== null;
  }

  async prepare(context: DeliveryContext): Promise<{ threadId: string; text: string } | null> {
    const origin = this.#mailbox.messagingOrigin(context.delivery.id);
    if (!origin) return null;
    const link = this.store.link(origin.linkId);
    if (!link) return null;
    // A teammate's answer to a request the agent sent from this conversation. The delivery framing
    // presents it as a teammate's reply, and the turn's answer is posted to the conversation.
    if (context.delivery.sender.kind === "agent") return { threadId: link.threadId, text: context.delivery.text };
    const connection = this.store.connection(link.connectionId);
    const prompt = await this.#promptContext(link, origin);
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
  }

  /** The prompt context from the platform, or none when it is slow or fails: the message still runs. */
  async #promptContext(link: MessagingLink, origin: MessagingOrigin): Promise<MessagingPromptContext> {
    const fallback: MessagingPromptContext = {
      workspaceName: null,
      place: link.title,
      messages: [],
      cursor: null,
      skippedFiles: [],
    };
    const source = this.#contextSource;
    if (!source) return fallback;
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      return await Promise.race([
        source(link, origin),
        new Promise<MessagingPromptContext>((resolve) => {
          timer = setTimeout(() => resolve(fallback), CONTEXT_TIMEOUT_MS);
        }),
      ]);
    } catch {
      return fallback;
    } finally {
      clearTimeout(timer);
    }
  }

  /**
   * Takes the conversation events of a messaging thread, so the agent's public chat and the Team
   * API never see them, and reports turn starts and ends. Approvals are not taken: the host still
   * shows them.
   */
  event(event: AgentEvent): boolean {
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
        void this.#finished(link, event.turnId, event.status, started.origin, started.followUp);
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

  /** Stops what one author asked for in this link: the running turn and queued messages. */
  async stop(linkId: string, authorId: string): Promise<boolean> {
    const link = this.store.link(linkId);
    if (!link) return false;
    let stopped = false;
    for (const context of this.#mailbox.unresolvedMessagingDeliveries(linkId)) {
      const origin = this.#mailbox.messagingOrigin(context.delivery.id);
      if (!origin || origin.authorId !== authorId) continue;
      if (context.delivery.status === "queued") {
        await this.#mailbox.cancel(link.agentId, context.delivery.id);
        this.#publish({ type: "cancelled", link, origin });
        stopped = true;
      } else if (context.delivery.status === "running" && context.delivery.turnId) {
        await this.#hooks.interrupt(link.agentId, context.delivery.turnId, link.threadId);
        stopped = true;
      }
    }
    if (stopped) this.#hooks.schedule(link.agentId);
    return stopped;
  }

  /** Removes the agent's links and execution threads, and takes it out of every connection. The mailbox leaves separately. */
  async deleteForAgent(agentId: string): Promise<void> {
    for (const threadId of this.store.threadIdsForAgent(agentId)) await this.#hooks.forgetThread(threadId);
    this.store.deleteForAgent(agentId);
  }

  async #finished(
    link: MessagingLink,
    turnId: string,
    status: string,
    origin: MessagingOrigin | null,
    followUp: boolean,
  ): Promise<void> {
    const messages = this.#turnMessages(link, turnId);
    const answer = [...messages].reverse().find(isAnswer)?.text ?? null;
    const files: MessagingAnswerFile[] = [];
    for (const message of messages) {
      if (message.author === "user") continue;
      for (const attachment of message.attachments ?? []) {
        const resolved = await this.#mailbox.resolveAttachment(attachment.id);
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
  }

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
