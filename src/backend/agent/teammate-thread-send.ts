import { createHash } from "node:crypto";
import type { QueuedMessageReceipt } from "@openbot/contracts/ipc";
import { Effect, Result } from "effect";
import type { AgentTasks } from "../agent-tasks/agent-tasks";
import type { AgentThreadRecord } from "../agent-threads/agent-thread-store";
import type { MailboxStore, MessagingOrigin } from "../mailbox-store";
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
  /** Takes MCP credentials out of a refusal before the agent reads it. */
  redact(text: string): string;
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

/** One recipient whose thread did not start, with the localized reason that the agent can act on. */
export interface SentThreadRefusal {
  recipientAgentId: string;
  error: string;
}

/** The identity of one tool call, as the mailbox keys its idempotent writes. */
export interface ToolCallRef {
  threadId: string;
  turnId: string;
  callId: string;
}

/**
 * Sends one independent teammate message per recipient (#8134): each message starts a new side
 * thread of its recipient and runs there as its first work, so it does not wait in the recipient's
 * chat. The result still comes back to the sender. The recipients are independent: each one's
 * thread starts and takes its message on its own, so a refusal for one recipient leaves the
 * others' work out, and the result names every refusal. A retried call reuses the thread and the
 * message that the first call made.
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
  const threads: SentThread[] = [];
  const refused: SentThreadRefusal[] = [];
  for (const recipient of recipientValues) {
    const outcome = yield* sendToNewThread(deps, {
      params,
      senderAgentId,
      recipient,
      paths,
      text,
      expectsReply,
      messagingReturn: messagingReturn ?? undefined,
      senderTaskId: senderTaskId ?? undefined,
    }).pipe(Effect.result);
    if (Result.isFailure(outcome)) {
      refused.push({
        recipientAgentId: recipient,
        error: failureMessage(outcome.failure, deps.redact),
      });
    } else {
      threads.push(outcome.success);
    }
  }
  const snapshot = deps.conversation.ensureSnapshot(senderAgentId, params.threadId);
  deps.mailboxSync.syncMailboxMessages(snapshot);
  deps.conversation.emitConversation(snapshot);
  return {
    success: true,
    contentItems: [
      { type: "inputText", text: JSON.stringify({ threads, ...(refused.length > 0 ? { refused } : {}) }) },
    ],
  };
});

/** Starts one recipient's thread and takes the message into it, or fails with that recipient's reason. */
const sendToNewThread = Effect.fn("sendToNewThread")(function* (
  deps: TeammateThreadSendDeps,
  input: {
    params: ToolCallRef;
    senderAgentId: string;
    recipient: string;
    paths: readonly string[];
    text: string;
    expectsReply: boolean | undefined;
    messagingReturn: MessagingOrigin | undefined;
    senderTaskId: string | undefined;
  },
): Effect.fn.Return<SentThread, ToolOperationFailed> {
  const idempotencyKey = `teammate-thread:${createHash("sha256")
    .update(
      JSON.stringify([
        input.senderAgentId,
        input.params.threadId,
        input.params.turnId,
        input.params.callId,
        input.recipient,
      ]),
    )
    .digest("hex")}`;
  const earlier = deps.mailbox.deliveryForKey(idempotencyKey);
  // The first call of this tool call made the thread; a retried call reuses it.
  const task: AgentThreadRecord = earlier
    ? yield* toolStep(() =>
        deps.tasks.require(input.recipient, deps.mailbox.taskIdForDelivery(earlier.delivery.id) ?? ""),
      )
    : yield* deps.tasks.teammateThread(input.recipient, input.text).pipe(toToolOperationFailed);
  const receipt = yield* deps.mailbox
    .enqueue({
      sender: { kind: "agent", agentId: input.senderAgentId },
      recipientAgentIds: [task.agentId],
      taskId: task.taskId,
      text: input.text,
      sourcePaths: [...input.paths],
      replyToMessageId: null,
      ...(input.expectsReply === undefined ? {} : { expectsReply: input.expectsReply }),
      ...(input.messagingReturn ? { messagingReturn: input.messagingReturn } : {}),
      ...(input.senderTaskId ? { senderTaskId: input.senderTaskId } : {}),
      idempotencyKey,
    })
    .pipe(toToolOperationFailed, Effect.result);
  if (Result.isFailure(receipt)) {
    // A thread whose message the mailbox could not take is removed, so a retry starts clean.
    deps.tasks.discard(task);
    deps.tasks.changed(task.agentId);
    return yield* Effect.fail(receipt.failure);
  }
  const delivery = receipt.success.deliveries[0];
  if (!delivery) {
    deps.tasks.discard(task);
    deps.tasks.changed(task.agentId);
    return yield* Effect.fail(
      new ToolOperationFailed({ cause: new Error(`The message for ${task.agentId} has no delivery.`) }),
    );
  }
  // A task message does not steer the recipient's chat turn. The drain takes it in the task's lane.
  deps.tasks.changed(task.agentId);
  deps.mailboxSync.emitQueue(task.agentId);
  deps.drain.scheduleDrain(task.agentId);
  return {
    recipientAgentId: task.agentId,
    taskId: task.taskId,
    threadId: task.threadId,
    title: task.title,
    messageId: receipt.success.messageId,
    deliveryId: delivery.id,
    status: delivery.status,
    position: delivery.position,
  };
});

function failureMessage(failure: ToolOperationFailed, redact: (text: string) => string): string {
  return failure.cause instanceof Error ? redact(failure.cause.message) : redact(String(failure.cause));
}
