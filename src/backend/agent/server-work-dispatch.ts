import { createHash } from "node:crypto";
import { INPUT_LIMITS } from "@openbot/contracts/input-limits";
import type { AgentSummary, AgentTask, QueuedMessageReceipt } from "@openbot/contracts/ipc";
import { sourceText } from "@openbot/i18n/source";
import { Effect } from "effect";
import { z } from "zod";
import type { AgentTasks } from "../agent-tasks/agent-tasks";
import type { AgentThreadRecord } from "../agent-threads/agent-thread-store";
import type { MailboxStore, MessagingOrigin } from "../mailbox-store";
import type { AgentServerWorkPolicy } from "./server-work-policy";
import type { ServerWorkRoutePlan, ServerWorkRouting } from "./server-work-routing";
import { toolCallIdempotencyKey } from "./tool-call-idempotency";
import { ToolOperationFailed, toToolOperationFailed } from "./tool-operation";

const identifier = z.string().trim().min(1).max(INPUT_LIMITS.identifier);
export const dispatchWorkToolSchema = z.strictObject({
  recipientAgentId: identifier,
  text: z.string().trim().min(1).max(INPUT_LIMITS.messageText),
  title: z.string().trim().min(1).max(INPUT_LIMITS.agentTaskTitle).optional(),
  workKey: z.string().trim().min(1).max(256).optional(),
  taskId: identifier.optional(),
  requestId: identifier.optional(),
  reopen: z.boolean().optional(),
});
export const findWorkToolSchema = z.strictObject({
  recipientAgentId: identifier,
  workKey: z.string().trim().min(1).max(256).optional(),
  taskId: identifier.optional(),
  query: z.string().trim().max(256).optional(),
  limit: z.number().int().min(1).max(INPUT_LIMITS.agentTasks).optional(),
});

export interface ServerWorkRequest {
  senderAgentId: string;
  recipientAgentId: string;
  text: string;
  title?: string;
  workKey?: string;
  taskId?: string;
  requestId: string;
  sourceTurnId?: string;
  /** The originating tool's released key also deduplicates a retry after a mode change. */
  sourceIdempotencyKey?: string;
  senderTaskId?: string;
  replyToMessageId?: string;
  expectsReply?: boolean;
  reopen?: boolean;
  sourcePaths?: string[];
  messagingReturn?: MessagingOrigin;
  /** Automatic Thread mode may ask the host decider; explicit keyed work never does. */
  automaticRoute?: boolean;
}

export interface ServerWorkSummary {
  workId: string;
  taskId: string;
  agentId: string;
  title: string;
  state: AgentTask["state"];
  hold: AgentTask["hold"];
  outcome: AgentTask["outcome"];
  updatedAt: string;
}

export interface ServerWorkDispatchOptions {
  tasks: AgentTasks;
  mailbox: MailboxStore;
  policy(agentId: string): AgentServerWorkPolicy | null;
  visibleAgents(): AgentSummary[];
  /** A real common sidebar section, else the requesting agent's private scope. */
  sharingScope(senderAgentId: string, recipientAgentId: string): string;
  queued(agentId: string): void;
  routing?: ServerWorkRouting | null;
}

/**
 * Owns host-only work routing. Stable scoped ids use the existing transactional thread store and
 * survive restarts without a second database or a custom numbered migration. The key is hashed;
 * discovery returns permitted metadata only. Released task payloads and client apps stay unchanged.
 */
export class ServerWorkDispatch {
  readonly #options: ServerWorkDispatchOptions;

  constructor(options: ServerWorkDispatchOptions) {
    this.#options = options;
  }

  #requireVisible(caller: string, target: string): void {
    const known = new Set(this.#options.visibleAgents().map((agent) => agent.id));
    if (!known.has(caller) || !known.has(target)) throw new Error(sourceText("error.backend.threadNotFound"));
  }

  #prefix(caller: string, target: string): string {
    return `openbot-work-${hash([target, this.#options.sharingScope(caller, target)]).slice(0, 20)}-`;
  }

  #id(caller: string, target: string, kind: string, key: string): string {
    return `${this.#prefix(caller, target)}${hash([target, kind, key]).slice(0, 40)}`;
  }

  #allowed(caller: string, target: string, task: AgentThreadRecord): boolean {
    return (
      task.agentId === target &&
      task.threadId.startsWith("openbot-work-") &&
      (caller === target || task.threadId.startsWith(this.#prefix(caller, target)))
    );
  }

  #summary(task: AgentThreadRecord): ServerWorkSummary {
    const view = this.#options.tasks.publicTask(task);
    return {
      workId: task.taskId,
      taskId: task.taskId,
      agentId: task.agentId,
      title: view.title,
      state: view.state,
      hold: view.hold,
      outcome: view.outcome,
      updatedAt: view.updatedAt,
    };
  }

  find(input: {
    callerAgentId: string;
    recipientAgentId: string;
    workKey?: string;
    taskId?: string;
    query?: string;
    limit?: number;
  }): ServerWorkSummary[] {
    this.#requireVisible(input.callerAgentId, input.recipientAgentId);
    const exact =
      input.taskId ??
      (input.workKey ? this.#id(input.callerAgentId, input.recipientAgentId, "key", input.workKey) : null);
    const candidates = exact
      ? this.#options.tasks.has(input.recipientAgentId, exact)
        ? [this.#options.tasks.require(input.recipientAgentId, exact)]
        : []
      : this.#options.tasks.listWork(input.recipientAgentId);
    const query = input.query?.toLowerCase();
    return candidates
      .filter((task) => this.#allowed(input.callerAgentId, input.recipientAgentId, task))
      .filter((task) => !query || task.title.toLowerCase().includes(query))
      .slice(0, input.limit ?? INPUT_LIMITS.agentTasks)
      .map((task) => this.#summary(task));
  }

  /** Admission is serial; execution is not. Return a receipt and end the parent turn. */
  readonly dispatch = Effect.fn("ServerWorkDispatch.dispatch")(
    function* (
      this: ServerWorkDispatch,
      input: ServerWorkRequest,
    ): Effect.fn.Return<{ work: ServerWorkSummary; receipt: QueuedMessageReceipt }, ToolOperationFailed> {
      const result = yield* this.#options.tasks.withWorkAdmission(
        input.recipientAgentId,
        this.#dispatch({ ...input, automaticRoute: false }),
      );
      if (!result.work) throw new Error("Explicit work must name a task.");
      return { work: result.work, receipt: result.receipt };
    },
    Effect.catchDefect((cause) => Effect.fail(new ToolOperationFailed({ cause }))),
    Effect.uninterruptible,
  );

  readonly dispatchAutomatic = Effect.fn("ServerWorkDispatch.dispatchAutomatic")(
    function* (this: ServerWorkDispatch, input: ServerWorkRequest) {
      this.#requireVisible(input.senderAgentId, input.recipientAgentId);
      const requestHash = hash([input.senderAgentId, input.recipientAgentId, input.requestId]);
      const earlier =
        this.#options.mailbox.deliveryForKey(`server-work-receipt:${requestHash}`) ??
        (input.sourceIdempotencyKey ? this.#options.mailbox.deliveryForKey(input.sourceIdempotencyKey) : null);
      if (!earlier && !this.#options.policy(input.recipientAgentId))
        throw new Error(sourceText("error.backend.taskRemoteUnsupported"));
      const plan: ServerWorkRoutePlan | null =
        !earlier && this.#options.routing
          ? yield* this.#options.routing
              .plan({
                agentId: input.recipientAgentId,
                senderAgentId: input.senderAgentId,
                text: input.text,
                requestId: input.requestId,
              })
              .pipe(Effect.catch(() => Effect.succeed({ kind: "main" as const })))
          : null;
      return yield* this.#options.tasks.withWorkAdmission(
        input.recipientAgentId,
        this.#dispatch({ ...input, automaticRoute: true }, plan),
      );
    },
    Effect.catchDefect((cause) => Effect.fail(new ToolOperationFailed({ cause }))),
    Effect.uninterruptible,
  );

  readonly #dispatch = Effect.fn("ServerWorkDispatch.enqueue")(function* (
    this: ServerWorkDispatch,
    input: ServerWorkRequest,
    plannedRoute: ServerWorkRoutePlan | null = null,
  ): Effect.fn.Return<{ work: ServerWorkSummary | null; receipt: QueuedMessageReceipt }, ToolOperationFailed> {
    this.#requireVisible(input.senderAgentId, input.recipientAgentId);
    const requestHash = hash([input.senderAgentId, input.recipientAgentId, input.requestId]);
    const idempotencyAlias = `server-work-receipt:${requestHash}`;
    const earlier =
      this.#options.mailbox.deliveryForKey(idempotencyAlias) ??
      (input.sourceIdempotencyKey ? this.#options.mailbox.deliveryForKey(input.sourceIdempotencyKey) : null);
    const earlierTaskId = earlier ? this.#options.mailbox.taskIdForDelivery(earlier.delivery.id) : null;
    if (earlier && input.automaticRoute) {
      if (earlier.delivery.recipientAgentId !== input.recipientAgentId)
        throw new Error(sourceText("error.backend.threadMoveRefused"));
      const receipt =
        this.#options.mailbox.receiptForKey(idempotencyAlias) ??
        (input.sourceIdempotencyKey ? this.#options.mailbox.receiptForKey(input.sourceIdempotencyKey) : null);
      if (!receipt) throw new Error(sourceText("error.backend.queuedMessageNotFound"));
      const task =
        earlierTaskId && this.#options.tasks.has(input.recipientAgentId, earlierTaskId)
          ? this.#options.tasks.require(input.recipientAgentId, earlierTaskId)
          : null;
      return {
        receipt,
        work: task && this.#allowed(input.senderAgentId, input.recipientAgentId, task) ? this.#summary(task) : null,
      };
    }
    if (!this.#options.policy(input.recipientAgentId))
      throw new Error(sourceText("error.backend.taskRemoteUnsupported"));
    const plan: ServerWorkRoutePlan | null =
      plannedRoute &&
      this.#options.routing &&
      !this.#options.routing.isPlanCurrent(
        { agentId: input.recipientAgentId, senderAgentId: input.senderAgentId },
        plannedRoute,
      )
        ? { kind: "main" as const }
        : plannedRoute;
    const canonicalId =
      input.taskId ??
      (input.automaticRoute ? (earlierTaskId ?? plan?.taskId) : undefined) ??
      this.#id(
        input.senderAgentId,
        input.recipientAgentId,
        input.workKey ? "key" : "request",
        input.workKey ?? JSON.stringify([input.senderAgentId, input.requestId]),
      );
    const idempotencyKey =
      input.sourceIdempotencyKey ??
      toolCallIdempotencyKey({
        threadId: `server-work-${requestHash}`,
        turnId: input.sourceTurnId ?? "server-work",
        callId: "request",
      });
    if (
      earlier &&
      !(input.automaticRoute && earlierTaskId === null) &&
      this.#options.mailbox.taskIdForDelivery(earlier.delivery.id) !== canonicalId
    )
      throw new Error("This requestId already names different work. Use a new requestId for a new request.");
    // A main decision retains the original recipient chat and still uses the same stable receipt.
    if (plan?.kind === "main" || (input.automaticRoute && earlier && !earlierTaskId)) {
      const receipt = yield* this.#options.mailbox
        .enqueue({
          sender: { kind: "agent", agentId: input.senderAgentId },
          recipientAgentIds: [input.recipientAgentId],
          text: input.text,
          idempotencyKey,
          idempotencyAlias,
          ...(input.senderTaskId ? { senderTaskId: input.senderTaskId } : {}),
          ...(input.sourcePaths ? { sourcePaths: input.sourcePaths } : {}),
          ...(input.messagingReturn ? { messagingReturn: input.messagingReturn } : {}),
        })
        .pipe(toToolOperationFailed);
      this.#options.queued(input.recipientAgentId);
      return { work: null, receipt };
    }
    let created = false;
    const task = yield* Effect.gen({ self: this }, function* () {
      const tasks = this.#options.tasks;
      if (tasks.has(input.recipientAgentId, canonicalId)) {
        const existing = tasks.require(input.recipientAgentId, canonicalId);
        if (!this.#allowed(input.senderAgentId, input.recipientAgentId, existing))
          throw new Error(sourceText("error.backend.threadNotFound"));
        if (!earlier) tasks.assertWorkAdmission(input.recipientAgentId, canonicalId);
        if (existing.closedAt !== null) {
          if (!input.reopen) throw new Error(sourceText("error.backend.threadArchived"));
          tasks.reopen(existing);
        }
        return tasks.require(input.recipientAgentId, canonicalId);
      }
      if (input.taskId) throw new Error(sourceText("error.backend.threadNotFound"));
      const record = yield* tasks.createWork(
        input.recipientAgentId,
        input.title ?? plan?.title ?? input.text,
        canonicalId,
      );
      created = true;
      return record;
    });
    let committed = false;
    const receipt = yield* this.#options.mailbox
      .enqueue({
        sender: { kind: "agent", agentId: input.senderAgentId },
        recipientAgentIds: [input.recipientAgentId],
        taskId: task.taskId,
        text: input.text,
        ...(input.senderTaskId ? { senderTaskId: input.senderTaskId } : {}),
        ...(input.replyToMessageId ? { replyToMessageId: input.replyToMessageId } : {}),
        ...(input.expectsReply === undefined ? {} : { expectsReply: input.expectsReply }),
        ...(input.sourcePaths ? { sourcePaths: input.sourcePaths } : {}),
        ...(input.messagingReturn ? { messagingReturn: input.messagingReturn } : {}),
        idempotencyKey,
        idempotencyAlias,
        beforeCommit: () => {
          this.#requireVisible(input.senderAgentId, input.recipientAgentId);
          const current = this.#options.tasks.requireOpen(input.recipientAgentId, task.taskId);
          if (
            current.createdAt !== task.createdAt ||
            !this.#allowed(input.senderAgentId, input.recipientAgentId, current)
          )
            throw new Error(sourceText("error.backend.threadNotFound"));
        },
      })
      .pipe(
        toToolOperationFailed,
        Effect.tap(() =>
          Effect.sync(() => {
            committed = true;
          }),
        ),
        Effect.ensuring(
          Effect.sync(() => {
            if (!committed && created && !this.#options.mailbox.taskBusy(input.recipientAgentId, task.taskId)) {
              // discard checks the captured generation, committed messages and active turns.
              this.#options.tasks.discard(task);
              this.#options.tasks.changed(input.recipientAgentId);
            }
          }),
        ),
      );
    this.#options.tasks.changed(input.recipientAgentId);
    this.#options.queued(input.recipientAgentId);
    return { work: this.#summary(task), receipt };
  });
}

function hash(parts: readonly string[]): string {
  return createHash("sha256").update(JSON.stringify(parts)).digest("hex");
}
