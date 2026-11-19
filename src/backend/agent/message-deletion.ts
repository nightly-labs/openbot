import type { ConversationMessage, ConversationSnapshot, DeleteConversationMessageInput } from "@openbot/contracts/ipc";
import { Effect } from "effect";
import type { AgentStore } from "../agent-store";
import type { AgentTasks } from "../agent-tasks/agent-tasks";
import type { MailboxStore } from "../mailbox-store";
import { type MessageDeleteAccess, MessageDeleteRefused } from "../message-delete";
import { type StoredStateFailure, storedSync } from "../stored-state-effects";
import type { ConversationRuntime } from "./conversation-runtime";

export interface MessageDeletionOptions {
  store: AgentStore;
  mailbox: MailboxStore;
  conversation: ConversationRuntime;
  tasks: AgentTasks;
}

const MESSAGE_DELETED_EVENT = "conversation.message-deleted";

interface DeletionTarget {
  agentId: string;
  threadId: string;
  taskId: string | null;
  snapshot: ConversationSnapshot;
  message: ConversationMessage;
}

export class MessageDeletion {
  readonly #store: AgentStore;
  readonly #mailbox: MailboxStore;
  readonly #conversation: ConversationRuntime;
  readonly #tasks: AgentTasks;

  constructor(options: MessageDeletionOptions) {
    this.#store = options.store;
    this.#mailbox = options.mailbox;
    this.#conversation = options.conversation;
    this.#tasks = options.tasks;
  }

  readonly delete = Effect.fn("MessageDeletion.delete")(function* (
    this: MessageDeletion,
    input: DeleteConversationMessageInput,
    access: MessageDeleteAccess,
  ): Effect.fn.Return<void, MessageDeleteRefused | StoredStateFailure> {
    const target = yield* storedSync(() => this.#target(input));
    if (!target) return yield* new MessageDeleteRefused({ reason: "not-found" });
    const { agentId, threadId, taskId, snapshot, message } = target;
    if (!access.deleteAny && !sentBy(message, access.memberId))
      return yield* new MessageDeleteRefused({ reason: "forbidden" });
    if (this.#busy(snapshot, message)) return yield* new MessageDeleteRefused({ reason: "busy" });
    const mailbox = yield* this.#mailbox.deleteShownMessage(agentId, message.id);
    if (mailbox === "busy") return yield* new MessageDeleteRefused({ reason: "busy" });
    yield* storedSync(() => {
      const current = taskId ? this.#tasks.read(agentId, taskId) : this.#conversation.ensureSnapshot(agentId, threadId);
      const activeTurnId =
        current.threadId === threadId
          ? current.activeTurnId
          : this.#store.database.readConversationPage(agentId, threadId, { type: "latest" }, 1).activeTurnId;
      const revision = this.#store.database.persistConversationChanges({
        agentId,
        threadId,
        activeTurnId,
        changedMessages: [],
        deletedMessageIds: [message.id],
        eventType: MESSAGE_DELETED_EVENT,
        detail: { messageId: message.id },
      });
      const published = this.#conversation.forgetDeletedMessage(agentId, threadId, message.id, revision);
      if (published) this.#conversation.publishConversation(published);
      if (taskId) this.#tasks.changed(agentId);
    });
  }, Effect.uninterruptible);

  #target(input: DeleteConversationMessageInput): DeletionTarget | null {
    const agent = this.#store.list().find((candidate) => candidate.id === input.agentId);
    if (!agent) return null;
    const taskId = input.taskId ?? null;
    let snapshot: ConversationSnapshot;
    if (taskId) {
      if (!this.#tasks.has(agent.id, taskId)) return null;
      snapshot = this.#tasks.read(agent.id, taskId);
    } else {
      if (!agent.threadId) return null;
      snapshot = this.#conversation.ensureSnapshot(agent.id, agent.threadId);
    }
    const threadId = snapshot.threadId;
    if (!threadId) return null;
    const message =
      snapshot.messages.find((candidate) => candidate.id === input.messageId) ??
      this.#store.database.readConversationMessages(agent.id, threadId, [input.messageId])[0];
    return message ? { agentId: agent.id, threadId, taskId, snapshot, message } : null;
  }

  #busy(snapshot: ConversationSnapshot, message: ConversationMessage): boolean {
    if (message.status === "streaming") return true;
    if (snapshot.activeTurnId !== null && message.turnId === snapshot.activeTurnId) return true;
    if (message.delivery && isActiveStatus(message.delivery.status)) return true;
    const delivery = this.#mailbox.getDelivery(message.id)?.delivery;
    return delivery !== undefined && isActiveStatus(delivery.status);
  }
}

function isActiveStatus(status: string): boolean {
  return status === "queued" || status === "starting" || status === "running";
}

function sentBy(message: ConversationMessage, memberId: string | null): boolean {
  return message.author === "user" && message.source !== "routine" && (message.senderMember?.id ?? null) === memberId;
}
