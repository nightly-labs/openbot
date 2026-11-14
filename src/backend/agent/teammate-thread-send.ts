import { createHash } from "node:crypto";
import type { QueuedMessageReceipt } from "@openbot/contracts/ipc";
import { Effect, Result } from "effect";
import type { AgentTasks } from "../agent-tasks/agent-tasks";
import type { AgentThreadRecord } from "../agent-threads/agent-thread-store";
import type { MailboxStore } from "../mailbox-store";
import type { ConversationRuntime } from "./conversation-runtime";
import type { MailboxSync } from "./mailbox-sync";
import type { OpenBotToolResponse } from "./routine-tools";
import { ToolOperationFailed, toolStep, toToolOperationFailed } from "./tool-operation";

/** What one new-thread teammate send reads. The drain only schedules the recipient's queue. */
export interface TeammateThreadSendDeps {
  mailbox: MailboxStore;
  tasks: AgentTasks;
  mailboxSync: MailboxSync;
  conversation: ConversationRuntime;
  drain: { scheduleDrain(agentId: string): void };
}

/** One recipient's thread that the message starts and runs in, as the tool result names it. */
export interface SentThread {
  recipientAgentId: string;
  /** The side thread of the recipient that the message starts and runs in. */
  taskId: string;
  threadId: string;
  title: string;
  /** The request that the thread runs first. A later reply to it continues the thread. */
  messageId: string;
  deliveryId: string;
  status: QueuedMessageReceipt["deliveries"][number]["status"];
  position: QueuedMessageReceipt["deliveries"][number]["position"];
}

/** The identity of one tool call, as the mailbox keys its idempotent writes. */
export interface ToolCallRef {
  threadId: string;
  turnId: string;
  callId: string;
}

interface RecipientWork {
  recipient: string;
  task: AgentThreadRecord;
  /** True when an earlier attempt of this tool call already delivered the message. */
  reused: boolean;
  /** True from the moment the mailbox took this recipient's message. */
  delivered: boolean;
  /** True once this thread was removed, so one rollback never removes it twice. */
  removed: boolean;
}

/**
 * Sends one independent teammate message per recipient (#8134): each message starts a new side
 * thread of its recipient and runs there as its first work, so it does not wait in the recipient's
 * chat. The result still comes back to the sender. The whole send runs in the `start_task` permit,
 * so its check, create and deliver of every recipient stays serialized: a retried or concurrent
 * call of the same tool call reads the threads and messages that the first attempt made, and starts
 * no second ones. A limit refusal for one recipient refuses the whole send and leaves no thread
 * behind and sends nothing; a mailbox refusal keeps the threads whose messages the mailbox took and
 * removes the ones that took none, so a retry reuses the delivered work and starts clean for the
 * rest.
 */
export const sendMessageToNewThreads = Effect.fn("sendMessageToNewThreads")(function* (
  deps: TeammateThreadSendDeps,
  params: ToolCallRef,
  senderAgentId: string,
  recipientValues: readonly string[],
  paths: readonly string[],
  text: string,
  expectsReply: boolean | undefined,
): Effect.fn.Return<OpenBotToolResponse, ToolOperationFailed> {
  const turnDeliveries = deps.mailbox.findDeliveriesByTurn(senderAgentId, params.turnId);
  // A request from a Slack turn: the teammate's answer goes back to that Slack thread.
  const messagingReturn = turnDeliveries
    .map(({ delivery }) => deps.mailbox.messagingOrigin(delivery.id))
    .find((origin) => origin !== null);
  // A request from a side thread: the teammate's answer goes back to that thread.
  const senderTaskId = turnDeliveries
    .map(({ delivery }) => deps.mailbox.taskIdForDelivery(delivery.id))
    .find((taskId) => taskId !== null);
  const idempotencyKeyOf = (recipient: string) =>
    `teammate-thread:${createHash("sha256")
      .update(JSON.stringify([senderAgentId, params.threadId, params.turnId, params.callId, recipient]))
      .digest("hex")}`;
  const opened: RecipientWork[] = [];
  const threads: SentThread[] = [];

  /** Removes the threads of this call from `from` on that took no message. A reused or delivered one stays. */
  const discardUndelivered = (from: number): void => {
    for (const entry of opened.slice(from)) {
      if (entry.reused || entry.delivered || entry.removed) continue;
      entry.removed = true;
      deps.tasks.discard(entry.task);
      deps.tasks.changed(entry.task.agentId);
    }
  };

  yield* deps.tasks.withTeammatePermit(
    Effect.gen(function* () {
      // One thread exists for each recipient before any message is sent: a limit refusal for one
      // recipient removes the threads of this call that took no message, so nothing is sent and no
      // empty thread stays. A thread that an earlier attempt of this tool call delivered is reused
      // and never removed. The idempotency check reads the mailbox inside the permit, so a
      // concurrent call of the same tool call finds the message that the first one delivered.
      for (const recipient of recipientValues) {
        const key = idempotencyKeyOf(recipient);
        const receipt = deps.mailbox.receiptForKey(key);
        if (receipt) {
          const deliveryId = receipt.deliveries[0]?.id ?? "";
          const task = yield* toolStep(() =>
            deps.tasks.require(recipient, deps.mailbox.taskIdForDelivery(deliveryId) ?? ""),
          );
          opened.push({ recipient, task, reused: true, delivered: true, removed: false });
          continue;
        }
        const prepared = yield* deps.tasks.preparedTeammateThread(recipient, text).pipe(Effect.result);
        if (Result.isFailure(prepared)) return yield* Effect.fail(prepared.failure);
        opened.push({ recipient, task: prepared.success, reused: false, delivered: false, removed: false });
      }
      // The mailbox takes one message per thread, in the recipients' order. A thread that an
      // earlier attempt delivered reads its receipt again; a new one enqueues its message.
      for (const [index, entry] of opened.entries()) {
        const key = idempotencyKeyOf(entry.recipient);
        const known = deps.mailbox.receiptForKey(key);
        const queued = yield* (
          known
            ? Effect.succeed(known)
            : deps.mailbox
                .enqueue({
                  sender: { kind: "agent", agentId: senderAgentId },
                  recipientAgentIds: [entry.task.agentId],
                  taskId: entry.task.taskId,
                  text,
                  sourcePaths: [...paths],
                  replyToMessageId: null,
                  ...(expectsReply === undefined ? {} : { expectsReply }),
                  ...(messagingReturn ? { messagingReturn } : {}),
                  ...(senderTaskId ? { senderTaskId } : {}),
                  idempotencyKey: key,
                })
                .pipe(toToolOperationFailed)
        ).pipe(Effect.result);
        if (Result.isFailure(queued)) {
          discardUndelivered(index);
          return yield* Effect.fail(queued.failure);
        }
        const delivery = queued.success.deliveries[0];
        if (!delivery) {
          discardUndelivered(index);
          return yield* Effect.fail(
            new ToolOperationFailed({ cause: new Error(`The message for ${entry.task.agentId} has no delivery.`) }),
          );
        }
        entry.delivered = true;
        // A task message does not steer the recipient's chat turn. The drain takes it in the
        // task's lane.
        deps.tasks.changed(entry.task.agentId);
        deps.mailboxSync.emitQueue(entry.task.agentId);
        deps.drain.scheduleDrain(entry.task.agentId);
        threads.push({
          recipientAgentId: entry.task.agentId,
          taskId: entry.task.taskId,
          threadId: entry.task.threadId,
          title: entry.task.title,
          messageId: queued.success.messageId,
          deliveryId: delivery.id,
          status: delivery.status,
          position: delivery.position,
        });
      }
    }).pipe(
      // A refusal or a mailbox error removes the threads of this call that took no message while
      // the permit is still held, so the next caller never reads an empty thread of this call; a
      // thread that an earlier attempt delivered stays for the retry to reuse.
      Effect.catch((failure) =>
        Effect.sync(() => discardUndelivered(0)).pipe(Effect.asVoid, Effect.andThen(Effect.fail(failure))),
      ),
    ),
  );
  const snapshot = deps.conversation.ensureSnapshot(senderAgentId, params.threadId);
  deps.mailboxSync.syncMailboxMessages(snapshot);
  deps.conversation.emitConversation(snapshot);
  return {
    success: true,
    contentItems: [{ type: "inputText", text: JSON.stringify({ threads }) }],
  };
});
