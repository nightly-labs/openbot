import { createHash } from "node:crypto";
import { INPUT_LIMITS } from "@openbot/contracts/input-limits";
import type { QueueDelivery } from "@openbot/contracts/ipc";
import { sourceText } from "@openbot/i18n/source";
import { Effect } from "effect";
import { z } from "zod";
import type { AgentTasks } from "../agent-tasks/agent-tasks";
import type { MailboxStore } from "../mailbox-store";
import type { ServerWorkSummary } from "./server-work-dispatch";
import { isServerWorkThread } from "./server-work-identity";
import type { AgentServerWorkPolicy } from "./server-work-policy";
import { ToolOperationFailed, toolStep, toToolOperationFailed } from "./tool-operation";

export const listQueuedWorkToolSchema = z.strictObject({});
export const dispatchQueuedWorkToolSchema = z.strictObject({
  deliveryId: z.string().trim().min(1).max(INPUT_LIMITS.identifier),
  title: z.string().trim().min(1).max(INPUT_LIMITS.agentTaskTitle).optional(),
  taskId: z.string().trim().min(1).max(INPUT_LIMITS.identifier).optional(),
});

export interface QueuedWorkDispatchResult {
  work: ServerWorkSummary;
  deliveryId: string;
  messageId: string;
}

export interface QueuedWorkCandidate {
  deliveryId: string;
  messageId: string;
  sender: QueueDelivery["sender"];
  preview: string;
  /** Full original request, available only from this agent's own queue. */
  text: string;
  createdAt: string;
  eligible: boolean;
  reason: string | null;
}

export interface ServerWorkBacklogOptions {
  tasks: AgentTasks;
  mailbox: MailboxStore;
  policy(agentId: string): AgentServerWorkPolicy | null;
  sharingScope(senderAgentId: string, recipientAgentId: string): string;
  queued(agentId: string): void;
}

/**
 * Owns explicit admission of selected requests from the caller's main queue. It moves the original
 * delivery, so the message, sender, attachments, receipt and reply route stay the same. Queue metadata
 * cannot prove that a request is independent: the caller must keep approvals and follow-ups in their
 * original context. It never imports the agent service facade.
 */
export class ServerWorkBacklog {
  readonly #options: ServerWorkBacklogOptions;

  constructor(options: ServerWorkBacklogOptions) {
    this.#options = options;
  }

  /** Full text is limited to 100 rows from this agent's own queue; no other agent's transcript is read. */
  list(agentId: string): QueuedWorkCandidate[] {
    const enabled = this.#options.policy(agentId) !== null;
    return this.#options.mailbox
      .listQueue(agentId)
      .deliveries.filter((delivery) => delivery.status === "queued")
      .slice(0, 100)
      .map((delivery) => {
        const eligible = enabled && this.#options.mailbox.canMoveToWork(agentId, delivery.id);
        return {
          deliveryId: delivery.id,
          messageId: delivery.messageId,
          sender: delivery.sender,
          preview: delivery.text.slice(0, 500),
          text: delivery.text,
          createdAt: delivery.createdAt,
          eligible,
          reason: eligible
            ? null
            : enabled
              ? "This request requires its original context or is not an independent single-recipient request."
              : "Thread routing is disabled for this agent.",
        };
      });
  }

  readonly dispatch = Effect.fn("ServerWorkBacklog.dispatch")(
    function* (
      this: ServerWorkBacklog,
      agentId: string,
      deliveryId: string,
      title?: string,
      targetTaskId?: string,
    ): Effect.fn.Return<QueuedWorkDispatchResult, ToolOperationFailed> {
      return yield* this.#options.tasks.withWorkAdmission(
        agentId,
        this.#move(agentId, deliveryId, title, targetTaskId),
      );
    },
    Effect.catchDefect((cause) => Effect.fail(new ToolOperationFailed({ cause }))),
    Effect.uninterruptible,
  );

  readonly #move = Effect.fn("ServerWorkBacklog.move")(function* (
    this: ServerWorkBacklog,
    agentId: string,
    deliveryId: string,
    title: string | undefined,
    targetTaskId: string | undefined,
  ): Effect.fn.Return<QueuedWorkDispatchResult, ToolOperationFailed> {
    if (!this.#options.policy(agentId)) throw new Error(sourceText("error.backend.taskRemoteUnsupported"));
    const context = this.#options.mailbox.getDelivery(deliveryId);
    if (!context || context.delivery.recipientAgentId !== agentId)
      throw new Error(sourceText("error.backend.queuedMessageNotFound"));
    const senderAgentId = context.delivery.sender.kind === "agent" ? context.delivery.sender.agentId : agentId;
    const scope = this.#options.sharingScope(senderAgentId, agentId);
    const prefix = `openbot-work-${hash([agentId, scope]).slice(0, 20)}-`;
    const threadId = targetTaskId ?? `${prefix}${hash([agentId, "queued", deliveryId]).slice(0, 40)}`;
    if (!isServerWorkThread(threadId) || !threadId.startsWith(prefix))
      throw new Error(sourceText("error.backend.threadMoveRefused"));
    if (targetTaskId) this.#options.tasks.requireOpen(agentId, targetTaskId);
    const assigned = this.#options.mailbox.taskIdForDelivery(deliveryId);
    if (assigned === threadId && this.#options.tasks.has(agentId, threadId)) {
      return { work: this.#summary(agentId, threadId), deliveryId, messageId: context.delivery.messageId };
    }
    if (!this.#options.mailbox.canMoveToWork(agentId, deliveryId))
      throw new Error(sourceText("error.backend.threadMoveRefused"));
    const existed = this.#options.tasks.has(agentId, threadId);
    const task = targetTaskId
      ? yield* toolStep(() => {
          this.#options.tasks.assertWorkAdmission(agentId, targetTaskId);
          return this.#options.tasks.requireOpen(agentId, targetTaskId);
        })
      : yield* this.#options.tasks.createWork(agentId, title ?? context.delivery.text, threadId);
    let moved = false;
    yield* toolStep(() => {
      if (!this.#options.mailbox.canMoveToWork(agentId, deliveryId))
        throw new Error(sourceText("error.backend.threadMoveRefused"));
      this.#options.tasks.requireOpen(agentId, task.taskId);
    }).pipe(
      Effect.flatMap(() =>
        this.#options.mailbox
          .moveToTask(agentId, deliveryId, task.taskId, { allowAgentRequests: true })
          .pipe(toToolOperationFailed),
      ),
      Effect.tap(() =>
        Effect.sync(() => {
          moved = true;
        }),
      ),
      Effect.ensuring(
        Effect.sync(() => {
          if (!moved && !existed && !this.#options.mailbox.taskBusy(agentId, task.taskId)) {
            this.#options.tasks.discard(task);
            this.#options.tasks.changed(agentId);
          }
        }),
      ),
    );
    this.#options.tasks.changed(agentId);
    this.#options.queued(agentId);
    return { work: this.#summary(agentId, task.taskId), deliveryId, messageId: context.delivery.messageId };
  });

  #summary(agentId: string, taskId: string): ServerWorkSummary {
    const task = this.#options.tasks.publicTask(this.#options.tasks.require(agentId, taskId));
    return {
      workId: taskId,
      taskId,
      agentId,
      title: task.title,
      state: task.state,
      hold: task.hold,
      outcome: task.outcome,
      updatedAt: task.updatedAt,
    };
  }
}

function hash(parts: readonly string[]): string {
  return createHash("sha256").update(JSON.stringify(parts)).digest("hex");
}
