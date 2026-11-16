import {
  type ConversationMessage,
  MESSAGE_PIN_TEXT_LIMIT,
  MESSAGE_PIN_THREAD_TITLE_LIMIT,
  MESSAGE_PINS_LIMIT,
  MESSAGE_PINS_LIST_LIMIT,
  type MessagePinner,
  type PinnedMessage,
  type PinnedMessagesSnapshot,
  type SetMessagePinnedInput,
} from "@openbot/contracts/ipc";
import { Effect } from "effect";
import type { AgentStore } from "../agent-store";
import type { AgentTasks } from "../agent-tasks/agent-tasks";
import type { PinnedThreadMessage } from "../database/pinned-thread-messages";
import { MessagePinRefused } from "../message-pins";
import { type StoredStateFailure, storedSync } from "../stored-state-effects";

export interface MessagePinsOptions {
  store: AgentStore;
  tasks: AgentTasks;
  /** A pin of the agent changed, so each client reads the list again. */
  changed: (agentId: string) => void;
}

/** Why the agent's own pin or unpin did not change the list. */
export type AgentPinRefusal = MessagePinRefused["reason"] | "pinned-by-person" | "not-pinnable-chat";

/** The most messages that a quote finds, so a short quote does not read the whole thread. */
const QUOTE_MATCH_LIMIT = 20;

/**
 * Owns the pinned messages of an agent's own chat and of its side threads. A person pins from the
 * menu of a message; the agent pins with its `pin_message` tool, and it cannot unpin the pin of a
 * person. A pin names a shown message of the thread, and the list reads each message from the
 * database, so a pin shows a message that the open chat has not loaded, also one of an archived
 * thread. The list of an agent covers all its chats, so a client finds a pin in another thread.
 *
 * It never imports the agent service facade.
 */
export class MessagePins {
  readonly #store: AgentStore;
  readonly #tasks: AgentTasks;
  readonly #changed: (agentId: string) => void;

  constructor(options: MessagePinsOptions) {
    this.#store = options.store;
    this.#tasks = options.tasks;
    this.#changed = options.changed;
  }

  /** The pins of all chats of the agent, the newest first. An agent that does not exist has none. */
  list(agentId: string): PinnedMessagesSnapshot {
    const agent = this.#store.list().find((candidate) => candidate.id === agentId);
    if (!agent) return { agentId, pins: [] };
    const threadIds = [...(agent.threadId ? [agent.threadId] : []), ...this.#tasks.threadIdsForAgent(agentId)];
    const pins = this.#store.database
      .pinnedThreadMessages(threadIds, MESSAGE_PINS_LIST_LIMIT)
      .filter(({ message }) => canPin(message));
    const threads = new Map<string, { taskId: string; title: string } | null>();
    const thread = (threadId: string) => {
      if (threadId === agent.threadId) return null;
      if (!threads.has(threadId)) {
        const taskId = this.#tasks.taskForThread(threadId);
        threads.set(
          threadId,
          taskId && this.#tasks.has(agentId, taskId)
            ? { taskId, title: this.#tasks.require(agentId, taskId).title }
            : null,
        );
      }
      return threads.get(threadId) ?? null;
    };
    return { agentId, pins: pins.map((pin) => pinnedMessage(pin, thread(pin.threadId))) };
  }

  /** A person pins or unpins one shown message, and answers the pins after the change. */
  readonly set = Effect.fn("MessagePins.set")(function* (
    this: MessagePins,
    input: SetMessagePinnedInput,
    pinner: Extract<MessagePinner, { kind: "person" }>,
  ): Effect.fn.Return<PinnedMessagesSnapshot, MessagePinRefused | StoredStateFailure> {
    const refusal = yield* storedSync(() => {
      const threadId = this.#threadId(input.agentId, input.taskId);
      return threadId ? this.#write(input.agentId, threadId, input.messageId, input.pinned, pinner) : "not-found";
    });
    // Only the agent's own pin gets these reasons; the narrowing keeps the public ones.
    if (refusal === "pinned-by-person" || refusal === "not-pinnable-chat")
      return yield* new MessagePinRefused({ reason: "not-found" });
    if (refusal) return yield* new MessagePinRefused({ reason: refusal });
    return yield* storedSync(() => this.list(input.agentId));
  }, Effect.uninterruptible);

  /**
   * The newest shown message of the agent's chat or side thread whose text contains `quote`, or null.
   * The `pin_message` tool names a message with it, as the agent does not see message ids. It skips
   * `exclude`: the user's request that quotes the message also contains the quote. For an unpin it
   * takes the newest pinned match, so an unpinned newer copy of the text does not hide the pin.
   */
  findByQuote(
    agentId: string,
    threadId: string,
    quote: string,
    options: { exclude: ReadonlySet<string>; pinned: boolean },
  ): ConversationMessage | null {
    if (!this.#pinnableThread(agentId, threadId)) return null;
    const database = this.#store.database;
    return (
      database
        .threadMessagesContaining(threadId, quote, QUOTE_MATCH_LIMIT)
        .find(
          (message) =>
            canPin(message) &&
            !options.exclude.has(message.id) &&
            (options.pinned || database.threadMessagePinner(threadId, message.id) !== null),
        ) ?? null
    );
  }

  /** The agent pins or unpins one shown message of the chat that it works in. */
  readonly setByAgent = Effect.fn("MessagePins.setByAgent")(function* (
    this: MessagePins,
    input: { agentId: string; threadId: string; messageId: string; pinned: boolean },
  ): Effect.fn.Return<
    { refused: AgentPinRefusal } | { refused: null; snapshot: PinnedMessagesSnapshot },
    StoredStateFailure
  > {
    const refused = yield* storedSync(() =>
      this.#pinnableThread(input.agentId, input.threadId)
        ? this.#write(input.agentId, input.threadId, input.messageId, input.pinned, {
            kind: "agent",
            agentId: input.agentId,
          })
        : "not-pinnable-chat",
    );
    if (refused) return { refused };
    return { refused: null, snapshot: yield* storedSync(() => this.list(input.agentId)) };
  }, Effect.uninterruptible);

  /** A message, the history of a chat or a side thread was deleted, and its pins with it. */
  messagesDeleted(agentId: string): void {
    this.#changed(agentId);
  }

  #write(
    agentId: string,
    threadId: string,
    messageId: string,
    pinned: boolean,
    pinner: MessagePinner,
  ): AgentPinRefusal | null {
    const database = this.#store.database;
    const current = database.threadMessagePinner(threadId, messageId);
    if (!pinned) {
      if (!current) return null;
      // The agent keeps the pins that a person made.
      if (pinner.kind === "agent" && current.kind === "person") return "pinned-by-person";
      database.unpinThreadMessage(threadId, messageId);
      this.#changed(agentId);
      return null;
    }
    const [message] = database.readConversationMessages(agentId, threadId, [messageId]);
    if (!message || !canPin(message)) return "not-found";
    if (current) return null;
    if (database.pinnedThreadMessageCount(threadId) >= MESSAGE_PINS_LIMIT) return "limit";
    database.pinThreadMessage(threadId, message.id, new Date().toISOString(), pinner);
    this.#changed(agentId);
    return null;
  }

  /** The thread of the agent's own chat or of one of its side threads, or null when there is none. */
  #threadId(agentId: string, taskId: string | undefined): string | null {
    const agent = this.#store.list().find((candidate) => candidate.id === agentId);
    if (!agent) return null;
    if (taskId === undefined) return agent.threadId ?? null;
    // An archived thread keeps its messages and its pins.
    return this.#tasks.has(agent.id, taskId) ? this.#tasks.require(agent.id, taskId).threadId : null;
  }

  /** The agent's own chat or one of its side threads. A channel or a linked messaging chat keeps no pins. */
  #pinnableThread(agentId: string, threadId: string): boolean {
    const agent = this.#store.list().find((candidate) => candidate.id === agentId);
    if (!agent) return false;
    if (agent.threadId === threadId) return true;
    const taskId = this.#tasks.taskForThread(threadId);
    return taskId !== null && this.#tasks.has(agentId, taskId);
  }
}

/** A finished message that a person or the agent wrote. A message that streams can still change. */
function canPin(message: ConversationMessage): boolean {
  return message.author !== "system" && message.status !== "streaming";
}

function pinnedMessage(
  { message, pinnedAt, pinnedBy }: PinnedThreadMessage,
  thread: { taskId: string; title: string } | null,
): PinnedMessage {
  const fromPerson = message.author === "user" && message.senderAgentId === undefined;
  const text = message.text.trim() || (message.attachments ?? []).map((attachment) => attachment.name).join(", ");
  return {
    messageId: message.id,
    taskId: thread?.taskId ?? null,
    threadTitle: thread ? thread.title.slice(0, MESSAGE_PIN_THREAD_TITLE_LIMIT) : null,
    pinnedAt,
    pinnedBy:
      pinnedBy.kind === "person" && pinnedBy.sender
        ? { kind: "person", sender: { id: pinnedBy.sender.id, name: pinnedBy.sender.name.slice(0, 120) } }
        : pinnedBy,
    author: message.author === "user" ? "user" : "agent",
    sender:
      fromPerson && message.senderMember
        ? { id: message.senderMember.id, name: message.senderMember.name.slice(0, 120) }
        : null,
    senderAgentId: message.senderAgentId ?? null,
    createdAt: message.createdAt,
    text: text.slice(0, MESSAGE_PIN_TEXT_LIMIT),
  };
}
