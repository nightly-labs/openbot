import { createHash, randomUUID } from "node:crypto";
import { agentProviderDescriptor } from "@openbot/contracts/agent-providers";
import { expandAttachmentReferences } from "@openbot/contracts/attachment-references";
import { chatBackdropPage, chatVisualReply } from "@openbot/contracts/chat-visual";
import { sortConversationMessages } from "@openbot/contracts/conversation-order";
import { INPUT_LIMITS } from "@openbot/contracts/input-limits";
import {
  AGENT_TASK_QUEUED_PREVIEW,
  type AgentEvent,
  type AgentSummary,
  type AgentTask,
  type AgentTaskBranch,
  type AgentTaskHold,
  type AgentTasksSnapshot,
  type AgentTurnCompletedEvent,
  type ArchivedAgentTasksCursor,
  type ArchivedAgentTasksPage,
  type AttachmentSummary,
  agentTaskLimit,
  type BranchAgentTaskInput,
  type ConversationMessage,
  type ConversationSnapshot,
  fitAgentTaskTitle,
} from "@openbot/contracts/ipc";
import { sourceText } from "@openbot/i18n/source";
import { createOpenBotLogger } from "@openbot/logging";
import { Deferred, Effect, Schema, Semaphore } from "effect";
import { z } from "zod";
import type { ConversationRuntime } from "../agent/conversation-runtime";
import {
  responseAttachmentMessageId,
  TASK_REPORT_CUT_MARK,
  type TaskReportState,
  visualReplyMessageId,
} from "../agent/delivery-content";
import type { TaskLanes } from "../agent/drain-scheduler";
import { type OpenBotToolResponse, openBotToolFailure, openBotToolResult } from "../agent/routine-tools";
import {
  type AgentThreadOrigin,
  type AgentThreadRecord,
  type AgentThreadStore,
  copyBranchMessages,
  type ThreadListPosition,
} from "../agent-threads/agent-thread-store";
import type { MailboxStore, TaskWork } from "../mailbox-store";
import type { DynamicToolCallParams } from "../protocol";
import { storedSync } from "../stored-state-effects";

const logger = createOpenBotLogger("agent-tasks");

const PROGRESS_PUBLISH_MS = 150;

const AGENT_STARTED_UNFINISHED_TASKS = 8;

const AGENT_STARTED_FINISHED_KEPT = 8;

export const START_TASK_TOOL = "start_task";

export const MESSAGE_TASK_TOOL = "message_task";

export const CLOSE_TASK_TOOL = "close_task";

const TASK_TOOLS: ReadonlySet<string> = new Set([START_TASK_TOOL, MESSAGE_TASK_TOOL, CLOSE_TASK_TOOL]);

const TASK_REPORT_ANSWER_LIMIT = 6000;

const TASK_REPORT_ERROR_LIMIT = 500;

const TASK_REPORT_RUNNING_LIMIT = 8;

const TASK_RESULT_FILES = INPUT_LIMITS.attachments;

export const startTaskToolSchema = z.strictObject({
  title: z.string().trim().min(1).max(INPUT_LIMITS.agentTaskTitle),
  brief: z.string().trim().min(1).max(INPUT_LIMITS.messageText),
});

const taskIdSchema = z.string().trim().min(1).max(INPUT_LIMITS.identifier);

export const messageTaskToolSchema = z.strictObject({
  taskId: taskIdSchema,
  text: z.string().trim().min(1).max(INPUT_LIMITS.messageText),
});

export const closeTaskToolSchema = z.strictObject({
  taskId: taskIdSchema,
});

export interface AgentTasksHooks {
  emit(event: AgentEvent): void;
  agent(agentId: string): AgentSummary | undefined;
  defaultTaskLimit(): number;
  hold(agentId: string, taskId: string): string | null;
  queued(agentId: string): void;
  turnActive(agentId: string, threadId: string): boolean;
  archived(agentId: string, tasks: readonly AgentThreadRecord[]): Effect.Effect<void>;
  turnAnswer(agentId: string, threadId: string, turnId: string): string | null;
  closeTask(agentId: string, taskId: string): Effect.Effect<void, unknown>;
  fork(work: Effect.Effect<void>): void;
}

export interface AgentTaskCaller {
  agentId: string;
  inExecutionThread: boolean;
  requesterIds: readonly string[];
}

export class AgentTaskBranchFailed extends Schema.TaggedError<AgentTaskBranchFailed>()("AgentTaskBranchFailed", {
  reason: Schema.Literals(["source-not-found", "source-busy", "message-not-found", "thread-limit", "storage"]),
  cause: Schema.Defect(),
}) {}

type BranchFailure = AgentTaskBranchFailed["reason"];

export class AgentThreadLimitError extends Error {
  constructor() {
    super(sourceText("error.backend.threadOpenLimitReached", { count: INPUT_LIMITS.agentTasks }));
  }
}

function branchStep<A>(reason: BranchFailure, run: () => A): Effect.Effect<A, AgentTaskBranchFailed> {
  return Effect.try({ try: run, catch: (cause) => new AgentTaskBranchFailed({ reason, cause }) });
}

export interface AgentTasksOptions {
  store: AgentThreadStore;
  mailbox: MailboxStore;
  conversation: ConversationRuntime;
  hooks: AgentTasksHooks;
}

export class AgentTasks implements TaskLanes {
  readonly #store: AgentThreadStore;
  readonly #mailbox: MailboxStore;
  readonly #conversation: ConversationRuntime;
  readonly #hooks: AgentTasksHooks;
  readonly #progress = new Map<string, string>();
  readonly #stoppedTurns = new Map<string, string>();
  readonly #userStops = new Map<string, string>();
  readonly #shownResults = new Set<string>();
  readonly #progressPublish = new Map<string, NodeJS.Timeout>();
  readonly #turnEndWaiters = new Map<string, Set<Deferred.Deferred<void>>>();
  readonly #pendingReports = new Map<string, number>();
  readonly #branches = Semaphore.makeUnsafe(1);
  readonly #starts = Semaphore.makeUnsafe(1);

  constructor(options: AgentTasksOptions) {
    this.#store = options.store;
    this.#mailbox = options.mailbox;
    this.#conversation = options.conversation;
    this.#hooks = options.hooks;
  }

  threadId(taskId: string): string | null {
    const task = this.#store.task(taskId);
    return task && task.closedAt === null ? task.threadId : null;
  }

  reporting(taskId: string): boolean {
    return this.#pendingReports.has(taskId);
  }

  openTaskIds(agentId: string): readonly string[] {
    return this.#store.openTaskIds(agentId);
  }

  limit(agentId: string): number {
    const agent = this.#hooks.agent(agentId);
    return agent ? agentTaskLimit(agent, this.#hooks.defaultTaskLimit()) : 1;
  }

  oneTurnAtATime(agentId: string): boolean {
    const agent = this.#hooks.agent(agentId);
    return agent !== undefined && !agentProviderDescriptor(agent.provider).concurrentTurns;
  }

  failed(taskId: string, message: string): void {
    const task = this.#store.task(taskId);
    if (!task) return;
    this.#store.setError(taskId, message.slice(0, INPUT_LIMITS.agentTaskError));
    this.changed(task.agentId);
  }

  snapshot(agentId: string): AgentTasksSnapshot {
    const tasks = this.#store.list(agentId);
    const work = tasks.some((task) => task.closedAt === null) ? this.#mailbox.taskWork(agentId) : new Map();
    const awaited = this.#mailbox.awaitedThreadRequests();
    return {
      agentId,
      tasks: tasks.map((task) => this.#publicTask(task, work, awaited)),
      limit: this.limit(agentId),
    };
  }

  archivedPage(agentId: string, before: ArchivedAgentTasksCursor | null): ArchivedAgentTasksPage {
    const rows = this.#store.archivedPage(agentId, before, INPUT_LIMITS.agentTasks + 1);
    const awaited = this.#mailbox.awaitedThreadRequests();
    return {
      tasks: rows.slice(0, INPUT_LIMITS.agentTasks).map((task) => this.#publicTask(task, new Map(), awaited)),
      hasMore: rows.length > INPUT_LIMITS.agentTasks,
    };
  }

  read(agentId: string, taskId: string): ConversationSnapshot {
    const task = this.#store.task(taskId);
    if (!task || task.agentId !== agentId) throw new Error(sourceText("error.backend.threadNotFound"));
    this.#conversation.registerTaskThread(agentId, task.threadId);
    return this.#conversation.ensureSnapshot(agentId, task.threadId);
  }

  requireOpen(agentId: string, taskId: string): AgentThreadRecord {
    const task = this.#store.task(taskId);
    if (!task || task.agentId !== agentId) throw new Error(sourceText("error.backend.threadNotFound"));
    if (task.closedAt !== null) throw new Error(sourceText("error.backend.threadArchived"));
    this.#conversation.registerTaskThread(agentId, task.threadId);
    return task;
  }

  recent(agentId: string, after: string | null, limit: number, last?: ThreadListPosition | null): AgentThreadRecord[] {
    return this.#store.recent(agentId, after, limit, last);
  }

  has(agentId: string, taskId: string): boolean {
    return this.#store.task(taskId)?.agentId === agentId;
  }

  require(agentId: string, taskId: string): AgentThreadRecord {
    const task = this.#store.task(taskId);
    if (!task || task.agentId !== agentId) throw new Error(sourceText("error.backend.threadNotFound"));
    return task;
  }

  create(agentId: string, text: string, origin: AgentThreadOrigin): AgentThreadRecord {
    const title = taskTitle(text);
    if (!title) throw new Error(sourceText("error.backend.threadTitleRequired"));
    this.#requireRoom(agentId);
    const task = this.#store.create({ agentId, origin, title, titleSource: origin === "agent" ? "agent" : "auto" });
    this.#conversation.registerTaskThread(agentId, task.threadId);
    return task;
  }

  routineThread(agentId: string, routineId: string, routineName: string): AgentThreadRecord | null {
    const existing = this.#store.threadForRoutine(agentId, routineId);
    const title = taskTitle(routineName);
    if (existing) {
      const opened = this.#openWithRoom(agentId, existing);
      return opened ? this.#followRoutineName(opened, title) : null;
    }
    if (this.#store.openTaskIds(agentId).length >= INPUT_LIMITS.agentTasks) return null;
    if (!title) return null;
    const task = this.#store.create({ agentId, origin: "agent", title, titleSource: "agent", routineId });
    this.#conversation.registerTaskThread(agentId, task.threadId);
    this.changed(agentId);
    return task;
  }

  isSideThread(agentId: string, taskId: string): boolean {
    const task = this.#store.task(taskId);
    return task?.agentId === agentId && task.origin === "user" && task.routineId === null;
  }

  waitThread(agentId: string, taskId: string): AgentThreadRecord | null {
    const task = this.#store.task(taskId);
    if (!task || !this.isSideThread(agentId, taskId)) return null;
    return this.#openWithRoom(agentId, task);
  }

  #openWithRoom(agentId: string, task: AgentThreadRecord): AgentThreadRecord | null {
    if (task.closedAt === null) {
      this.#conversation.registerTaskThread(agentId, task.threadId);
      return task;
    }
    if (this.#store.openTaskIds(agentId).length >= INPUT_LIMITS.agentTasks) return null;
    this.reopen(task);
    return this.#store.task(task.taskId);
  }

  #followRoutineName(thread: AgentThreadRecord, title: string | null): AgentThreadRecord {
    if (!title || thread.title === title || thread.titleSource === "user") return thread;
    this.#store.retitle(thread.threadId, title);
    this.changed(thread.agentId);
    return this.#store.task(thread.taskId) ?? thread;
  }

  taskReport(taskId: string): TaskReportState | null {
    const task = this.#store.task(taskId);
    if (!task || !isStartedTask(task)) return null;
    const stillRunning = this.#store
      .openTaskIds(task.agentId)
      .flatMap((otherId) => this.#store.task(otherId) ?? [])
      .filter((other) => other.taskId !== task.taskId && isStartedTask(other) && !this.#finished(other))
      .slice(0, TASK_REPORT_RUNNING_LIMIT)
      .map((other) => ({ taskId: other.taskId, title: other.title }));
    const outcome = task.outcome === "interrupted" && this.#userStops.has(task.taskId) ? "stopped" : task.outcome;
    return {
      taskId: task.taskId,
      title: task.title,
      outcome,
      closed: task.closedAt !== null,
      stillRunning,
      resultsShown: this.#shownResults.has(task.taskId),
    };
  }

  isRoutineThread(taskId: string): boolean {
    return (this.#store.task(taskId)?.routineId ?? null) !== null;
  }

  threadOfRoutine(agentId: string, routineId: string): AgentThreadRecord | null {
    return this.#store.threadForRoutine(agentId, routineId);
  }

  branch(input: BranchAgentTaskInput): Effect.Effect<AgentThreadRecord, AgentTaskBranchFailed> {
    return this.#branches.withPermit(this.#branch(input));
  }

  readonly #branch = Effect.fn("AgentTasks.branch")(function* (
    this: AgentTasks,
    input: BranchAgentTaskInput,
  ): Effect.fn.Return<AgentThreadRecord, AgentTaskBranchFailed> {
    const earlier = this.#store.branchFor(input.agentId, input.requestId);
    if (earlier) {
      this.#conversation.registerTaskThread(earlier.agentId, earlier.threadId);
      return earlier;
    }
    const source = yield* branchStep("source-not-found", () => this.#branchSource(input));
    yield* branchStep("source-busy", () => {
      if (source.running) throw new Error(sourceText("error.backend.branchSourceBusy"));
    });
    yield* branchStep("thread-limit", () => this.#requireRoom(input.agentId));
    const messages = yield* branchStep("message-not-found", () => {
      const rows = this.#store.branchSource(source.threadId, input.messageId);
      if (!rows) throw new Error(sourceText("error.backend.branchMessageNotFound"));
      return rows;
    });
    const title =
      source.title === null
        ? taskTitle(messages.findLast((message) => message.author === "user")?.text ?? "") ||
          sourceText("status.agent.branchTitle")
        : branchTitle(source.title, this.#store.titles(input.agentId));
    const threadId = `openbot-thread-${randomUUID()}`;
    const staged: string[] = [];
    const record = yield* Effect.gen({ self: this }, function* () {
      const files = new Map<string, AttachmentSummary>();
      for (const attachment of branchFiles(messages)) {
        if (files.has(attachment.id)) continue;
        const file = yield* this.#mailbox.resolveAttachment(attachment.id);
        if (!file) continue;
        const copy = yield* this.#mailbox.stageGeneratedCopy({
          sourcePath: file.path,
          name: file.name,
          mimeType: file.mimeType,
          ownerAgentId: input.agentId,
          ownerThreadId: threadId,
        });
        staged.push(copy.id);
        files.set(attachment.id, copy);
      }
      return yield* branchStep("storage", () =>
        this.#mailbox.persistGeneratedAttachmentsWith(staged, "attachment.branch-copied", () =>
          this.#store.branch({
            agentId: input.agentId,
            requestId: input.requestId,
            threadId,
            title,
            sourceThreadId: source.threadId,
            sourceMessageId: input.messageId,
            messages: copyBranchMessages(messages, files),
          }),
        ),
      );
    }).pipe(
      Effect.mapError((failure) =>
        failure instanceof AgentTaskBranchFailed
          ? failure
          : new AgentTaskBranchFailed({ reason: "storage", cause: failure.cause }),
      ),
      Effect.onError(() => this.#mailbox.discardStagedGeneratedAttachments(staged).pipe(Effect.ignore)),
    );
    this.#conversation.registerTaskThread(record.agentId, record.threadId);
    return record;
  });

  #branchSource(input: BranchAgentTaskInput): { threadId: string; title: string | null; running: boolean } {
    if (input.taskId === null) {
      const threadId = this.#hooks.agent(input.agentId)?.threadId;
      if (!threadId) throw new Error(sourceText("error.backend.threadNotFound"));
      const chat = this.#conversation.loadedSnapshot(input.agentId);
      return {
        threadId,
        title: null,
        running: chat?.threadId === threadId && chat.activeTurnId !== null,
      };
    }
    const task = this.require(input.agentId, input.taskId);
    return {
      threadId: task.threadId,
      title: task.branch && task.titleSource === "auto" ? task.title.replace(/ #\d+$/, "") : task.title,
      running:
        Boolean(this.#conversation.loadedExecutionSnapshot(task.threadId)?.activeTurnId) ||
        this.#mailbox.laneActive(task.agentId, task.taskId),
    };
  }

  #requireRoom(agentId: string): void {
    if (this.#store.openTaskIds(agentId).length >= INPUT_LIMITS.agentTasks) throw new AgentThreadLimitError();
  }

  discard(task: AgentThreadRecord): void {
    this.#conversation.forgetExecutionThread(task.threadId);
    this.#store.delete(task.taskId);
  }

  rename(task: AgentThreadRecord, title: string): void {
    const trimmed = title.trim();
    if (!trimmed || trimmed.length > INPUT_LIMITS.agentTaskTitle)
      throw new Error(sourceText("error.backend.threadTitleRequired"));
    this.#store.rename(task.threadId, trimmed);
    this.changed(task.agentId);
  }

  delete(task: AgentThreadRecord): void {
    this.#progress.delete(task.taskId);
    this.#stoppedTurns.delete(task.taskId);
    this.#userStops.delete(task.taskId);
    this.#shownResults.delete(task.taskId);
    this.#turnEndWaiters.delete(task.taskId);
    this.#store.delete(task.taskId);
    this.changed(task.agentId);
  }

  publicTask(task: AgentThreadRecord): AgentTask {
    return this.#publicTask(task, task.closedAt === null ? this.#mailbox.taskWork(task.agentId) : new Map());
  }

  close(task: AgentThreadRecord): void {
    this.#closeQuietly(task);
    this.changed(task.agentId);
  }

  #closeQuietly(task: AgentThreadRecord): void {
    this.#store.close(task.taskId);
    this.#progress.delete(task.taskId);
    this.#stoppedTurns.delete(task.taskId);
    this.#userStops.delete(task.taskId);
  }

  reopen(task: AgentThreadRecord): void {
    if (task.closedAt !== null) this.#requireRoom(task.agentId);
    this.#store.reopen(task.taskId);
    this.#conversation.registerTaskThread(task.agentId, task.threadId);
    this.changed(task.agentId);
  }

  turnEnd(taskId: string): Effect.Effect<void> {
    const ended = Deferred.makeUnsafe<void>();
    const waiters = this.#turnEndWaiters.get(taskId) ?? new Set<Deferred.Deferred<void>>();
    this.#turnEndWaiters.set(taskId, waiters.add(ended));
    return Deferred.await(ended).pipe(
      Effect.ensuring(
        Effect.sync(() => {
          waiters.delete(ended);
          if (waiters.size === 0 && this.#turnEndWaiters.get(taskId) === waiters) this.#turnEndWaiters.delete(taskId);
        }),
      ),
    );
  }

  markStopped(taskId: string, turnId: string, byUser: boolean): void {
    this.#stoppedTurns.set(taskId, turnId);
    if (byUser) this.#userStops.set(taskId, turnId);
    else this.#userStops.delete(taskId);
  }

  stoppedTurn(taskId: string): string | null {
    return this.#stoppedTurns.get(taskId) ?? null;
  }

  executionThreads(): Array<{ id: string; threadId: string }> {
    return this.#store.executionThreads();
  }

  openExecutionThreads(): Array<{ id: string; threadId: string }> {
    return this.#store.openExecutionThreads();
  }

  threadForDelivery(deliveryId: string): string | null {
    const taskId = this.#mailbox.taskIdForDelivery(deliveryId);
    return taskId ? (this.#store.task(taskId)?.threadId ?? null) : null;
  }

  deliveryTaskGone(deliveryId: string): boolean {
    const taskId = this.#mailbox.taskIdForDelivery(deliveryId);
    return taskId !== null && this.#store.task(taskId) === null;
  }

  readonly endWorkOfGoneTasks = Effect.fn("AgentTasks.endWorkOfGoneTasks")(function* (this: AgentTasks) {
    const agentIds = new Set<string>();
    for (const work of this.#mailbox.unfinishedTaskDeliveries()) {
      if (this.#store.task(work.taskId)) continue;
      if (work.queued) yield* storedSync(() => this.#mailbox.cancelNow(work.agentId, work.deliveryId));
      else
        yield* this.#mailbox.markTerminal(work.deliveryId, "interrupted", sourceText("error.backend.threadNotFound"));
      agentIds.add(work.agentId);
    }
    return [...agentIds];
  });

  isPersonThread(agentId: string, threadId: string): boolean {
    const thread = this.#store.taskForThread(threadId);
    return thread?.agentId === agentId && thread.origin === "user" && thread.routineId === null;
  }

  isBranchThread(threadId: string): boolean {
    return Boolean(this.#store.taskForThread(threadId)?.branch);
  }

  isRoutineThreadId(threadId: string): boolean {
    return (this.#store.taskForThread(threadId)?.routineId ?? null) !== null;
  }

  taskForThread(threadId: string): string | null {
    return this.#store.taskForThread(threadId)?.taskId ?? null;
  }

  threadIdsForAgent(agentId: string): string[] {
    return this.#store.threadIdsForAgent(agentId);
  }

  deleteForAgent(agentId: string): void {
    this.#cancelProgressPublish(agentId);
    for (const taskId of this.#store.taskIdsForAgent(agentId)) {
      this.#progress.delete(taskId);
      this.#stoppedTurns.delete(taskId);
      this.#userStops.delete(taskId);
      this.#shownResults.delete(taskId);
    }
    this.#store.deleteForAgent(agentId);
  }

  readonly handleTool = Effect.fn("AgentTasks.handleTool")(function* (
    this: AgentTasks,
    params: DynamicToolCallParams,
    caller: AgentTaskCaller,
  ): Effect.fn.Return<OpenBotToolResponse | null> {
    if (!TASK_TOOLS.has(params.tool)) return null;
    if (params.tool === MESSAGE_TASK_TOOL) {
      const parsed = messageTaskToolSchema.safeParse(params.arguments);
      if (!parsed.success) return openBotToolFailure(sourceText("error.backend.taskControlInvalid"));
      if (caller.inExecutionThread) return openBotToolFailure(sourceText("error.backend.taskOwnChatOnly"));
      return yield* this.#starts.withPermit(this.#message(params, caller, parsed.data));
    }
    if (params.tool === CLOSE_TASK_TOOL) {
      const parsed = closeTaskToolSchema.safeParse(params.arguments);
      if (!parsed.success) return openBotToolFailure(sourceText("error.backend.taskControlInvalid"));
      if (caller.inExecutionThread) return openBotToolFailure(sourceText("error.backend.taskOwnChatOnly"));
      return yield* this.#close(caller, parsed.data.taskId);
    }
    const parsed = startTaskToolSchema.safeParse(params.arguments);
    if (!parsed.success) return openBotToolFailure(sourceText("error.backend.taskToolInvalid"));
    if (caller.inExecutionThread) return openBotToolFailure(sourceText("error.backend.taskOwnChatOnly"));
    return yield* this.#starts.withPermit(this.#start(params, caller, parsed.data));
  });

  #startedBy(agentId: string, taskId: string): AgentThreadRecord | null {
    const task = this.#store.task(taskId);
    return task && isStartedTask(task) && task.agentId === agentId ? task : null;
  }

  readonly #message = Effect.fn("AgentTasks.message")(function* (
    this: AgentTasks,
    params: DynamicToolCallParams,
    caller: AgentTaskCaller,
    input: z.infer<typeof messageTaskToolSchema>,
  ): Effect.fn.Return<OpenBotToolResponse> {
    const task = this.#startedBy(caller.agentId, input.taskId);
    if (!task) return openBotToolFailure(sourceText("error.backend.taskNotFound"));
    const idempotencyKey = `message-task:${createHash("sha256")
      .update(JSON.stringify([caller.agentId, params.turnId, params.callId]))
      .digest("hex")}`;
    if (this.#mailbox.deliveryForKey(idempotencyKey)) return messagedTaskResult(task, false);
    const running = task.closedAt === null && !this.#finished(task);
    if (!running && this.#unfinishedTasks(caller.agentId) >= AGENT_STARTED_UNFINISHED_TASKS)
      return openBotToolFailure(
        sourceText("error.backend.taskUnfinishedLimit", { count: AGENT_STARTED_UNFINISHED_TASKS }),
      );
    if (task.closedAt !== null) {
      if (this.#store.openTaskIds(caller.agentId).length >= INPUT_LIMITS.agentTasks)
        return openBotToolFailure(
          sourceText("error.backend.threadOpenLimitReached", { count: INPUT_LIMITS.agentTasks }),
        );
      this.reopen(task);
    }
    const queued = yield* this.#mailbox
      .enqueue({
        sender: { kind: "agent", agentId: caller.agentId },
        requesterIds: caller.requesterIds,
        taskId: task.taskId,
        recipientAgentIds: [caller.agentId],
        text: input.text,
        replyToMessageId: null,
        idempotencyKey,
      })
      .pipe(
        Effect.as(true),
        Effect.catch((failure) =>
          Effect.sync(() => {
            logger.warn("Could not queue a message for a task.", { agentId: caller.agentId, error: failure.cause });
            return false;
          }),
        ),
      );
    if (!queued) return openBotToolFailure(sourceText("error.backend.taskMessageFailed"));
    this.changed(caller.agentId);
    this.#hooks.queued(caller.agentId);
    return messagedTaskResult(task, running);
  });

  readonly #close = Effect.fn("AgentTasks.close")(function* (
    this: AgentTasks,
    caller: AgentTaskCaller,
    taskId: string,
  ): Effect.fn.Return<OpenBotToolResponse> {
    const task = this.#startedBy(caller.agentId, taskId);
    if (!task) return openBotToolFailure(sourceText("error.backend.taskNotFound"));
    if (task.closedAt === null) {
      const closed = yield* this.#hooks.closeTask(caller.agentId, task.taskId).pipe(
        Effect.as(true),
        Effect.catch((failure) =>
          Effect.sync(() => {
            logger.warn("Could not close a task for its agent.", { agentId: caller.agentId, error: failure });
            return false;
          }),
        ),
      );
      if (!closed) return openBotToolFailure(sourceText("error.backend.taskStillRunning"));
    }
    return openBotToolResult({ taskId: task.taskId, title: task.title, state: "closed" });
  });

  readonly #start = Effect.fn("AgentTasks.start")(function* (
    this: AgentTasks,
    params: DynamicToolCallParams,
    caller: AgentTaskCaller,
    input: z.infer<typeof startTaskToolSchema>,
  ): Effect.fn.Return<OpenBotToolResponse> {
    const idempotencyKey = `start-task:${createHash("sha256")
      .update(JSON.stringify([caller.agentId, params.turnId, params.callId]))
      .digest("hex")}`;
    const started = this.#mailbox.deliveryForKey(idempotencyKey);
    const startedTaskId = started ? this.#mailbox.taskIdForDelivery(started.delivery.id) : null;
    const startedTask = startedTaskId ? this.#store.task(startedTaskId) : null;
    if (startedTask) return this.#startedResult(startedTask);
    const open = this.#store.openTaskIds(caller.agentId).flatMap((taskId) => this.#store.task(taskId) ?? []);
    const finished = open.filter((task) => this.#finished(task));
    if (this.#unfinishedTasks(caller.agentId) >= AGENT_STARTED_UNFINISHED_TASKS)
      return openBotToolFailure(
        sourceText("error.backend.taskUnfinishedLimit", { count: AGENT_STARTED_UNFINISHED_TASKS }),
      );
    const finishedByAgent = finished
      .filter(isStartedTask)
      .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt));
    const others = open.length - finishedByAgent.length;
    const kept = Math.max(0, Math.min(AGENT_STARTED_FINISHED_KEPT, INPUT_LIMITS.agentTasks - 1 - others));
    const archived = finishedByAgent.slice(kept);
    if (open.length - archived.length >= INPUT_LIMITS.agentTasks)
      return openBotToolFailure(sourceText("error.backend.threadOpenLimitReached", { count: INPUT_LIMITS.agentTasks }));
    for (const task of archived) this.#closeQuietly(task);
    const task = this.create(caller.agentId, input.title, "agent");
    if (archived.length > 0) yield* this.#hooks.archived(caller.agentId, archived);
    const queued = yield* this.#mailbox
      .enqueue({
        sender: { kind: "agent", agentId: caller.agentId },
        requesterIds: caller.requesterIds,
        taskId: task.taskId,
        heldRequestIds: this.#mailbox.openTeammateRequestIds(caller.agentId, params.turnId),
        recipientAgentIds: [caller.agentId],
        text: input.brief,
        replyToMessageId: null,
        idempotencyKey,
      })
      .pipe(
        Effect.as(true),
        Effect.catch((failure) =>
          Effect.sync(() => {
            logger.warn("Could not queue the brief of a new task.", { agentId: caller.agentId, error: failure.cause });
            return false;
          }),
        ),
      );
    for (const archivedTask of archived) yield* this.releaseHeldRequests(archivedTask);
    if (!queued) {
      this.discard(task);
      if (archived.length > 0) this.changed(caller.agentId);
      return openBotToolFailure(sourceText("error.backend.taskStartFailed"));
    }
    this.changed(caller.agentId);
    this.#hooks.queued(caller.agentId);
    return this.#startedResult(task);
  });

  #startedResult(task: AgentThreadRecord): OpenBotToolResponse {
    const waiting = [
      ...new Set(
        this.#mailbox
          .openRequestsHeldByTask(task.agentId, task.taskId)
          .flatMap((requestId) => this.#mailbox.requestSenderAgentId(requestId) ?? []),
      ),
    ].map((agentId) => this.#hooks.agent(agentId)?.name ?? agentId);
    return startedTaskResult(task, waiting);
  }

  readonly releaseHeldRequests = Effect.fn("AgentTasks.releaseHeldRequests")(function* (
    this: AgentTasks,
    task: AgentThreadRecord,
  ): Effect.fn.Return<void> {
    const requestIds = this.#requestsLeft(task);
    if (requestIds.length === 0) return;
    const queued = yield* this.#mailbox
      .enqueue({
        sender: { kind: "agent", agentId: task.agentId },
        requesterIds: this.#mailbox.taskRequesterIds(task.taskId),
        senderTaskId: task.taskId,
        heldRequestIds: requestIds,
        recipientAgentIds: [task.agentId],
        text: task.title,
        replyToMessageId: null,
        expectsReply: false,
        idempotencyKey: `task-release:${createHash("sha256")
          .update(JSON.stringify([task.taskId, requestIds]))
          .digest("hex")}`,
      })
      .pipe(
        Effect.as(true),
        Effect.catch((failure) =>
          Effect.sync(() => {
            logger.warn("Could not queue the report of a closed task.", {
              agentId: task.agentId,
              error: failure.cause,
            });
            return false;
          }),
        ),
      );
    if (queued) this.#hooks.queued(task.agentId);
  });

  readonly releaseAfterLostWork = Effect.fn("AgentTasks.releaseAfterLostWork")(function* (
    this: AgentTasks,
    taskId: string,
  ): Effect.fn.Return<void> {
    const task = this.#store.task(taskId);
    if (
      !task ||
      task.closedAt !== null ||
      this.#mailbox.taskAwaitsTeammate(task.agentId, taskId) ||
      this.#requestsLeft(task).length === 0
    )
      return;
    this.#store.setOutcome(taskId, "interrupted");
    this.changed(task.agentId);
    yield* this.releaseHeldRequests(task);
  });

  #requestsLeft(task: AgentThreadRecord): string[] {
    return this.#mailbox.requestsLeftByTask(task.agentId, task.taskId).filter((requestId) => {
      const requesterId = this.#mailbox.requestSenderAgentId(requestId);
      return requesterId !== null && this.#hooks.agent(requesterId) !== undefined;
    });
  }

  changed(agentId: string): void {
    this.#cancelProgressPublish(agentId);
    this.#hooks.emit({ type: "agent-tasks-changed", snapshot: this.snapshot(agentId) });
  }

  #progressChanged(agentId: string): void {
    if (this.#progressPublish.has(agentId)) return;
    this.#progressPublish.set(
      agentId,
      setTimeout(() => {
        this.#progressPublish.delete(agentId);
        try {
          this.changed(agentId);
        } catch (error) {
          logger.warn("Could not send the task list with its progress.", { agentId, error });
        }
      }, PROGRESS_PUBLISH_MS),
    );
  }

  #cancelProgressPublish(agentId: string): void {
    const timer = this.#progressPublish.get(agentId);
    if (!timer) return;
    clearTimeout(timer);
    this.#progressPublish.delete(agentId);
  }

  dispose(): void {
    for (const timer of this.#progressPublish.values()) clearTimeout(timer);
    this.#progressPublish.clear();
  }

  event(event: AgentEvent): boolean {
    switch (event.type) {
      case "conversation": {
        const task = this.#taskOf(event.snapshot.threadId);
        if (!task) return false;
        this.#hooks.emit({ type: "agent-task-conversation", taskId: task.taskId, snapshot: event.snapshot });
        return true;
      }
      case "conversation-delta": {
        const task = this.#taskOf(event.threadId);
        if (!task) return false;
        this.#hooks.emit({ ...event, type: "agent-task-conversation-delta", taskId: task.taskId });
        return true;
      }
      case "turn-progress": {
        const task = this.#taskOf(event.threadId);
        if (!task) return false;
        this.#progress.set(task.taskId, event.detail.slice(0, INPUT_LIMITS.agentTaskProgress));
        this.#progressChanged(task.agentId);
        return true;
      }
      case "turn-started": {
        const task = this.#taskOf(event.threadId);
        if (!task) return false;
        this.#progress.delete(task.taskId);
        if (this.#userStops.get(task.taskId) !== event.turnId) this.#userStops.delete(task.taskId);
        if (task.error !== null) this.#store.setError(task.taskId, null);
        this.#store.touch(task.taskId);
        this.changed(task.agentId);
        return true;
      }
      case "turn-completed": {
        const task = this.#taskOf(event.threadId);
        if (!task) return false;
        const announced = !event.quiet && !event.continues;
        const reports = announced && this.#reportsTurn(task, event);
        this.#progress.delete(task.taskId);
        this.#store.setOutcome(
          task.taskId,
          event.status === "completed" ? "completed" : event.status === "failed" ? "failed" : "interrupted",
        );
        this.changed(task.agentId);
        const waiters = this.#turnEndWaiters.get(task.taskId);
        this.#turnEndWaiters.delete(task.taskId);
        for (const ended of waiters ?? []) Deferred.doneUnsafe(ended, Effect.void);
        if (announced) {
          this.#hooks.emit({
            type: "thread-turn-completed",
            taskId: task.taskId,
            routine: task.routineId !== null,
            turn: event,
          });
          if (reports) this.#hooks.fork(this.#reportOnce(task, event));
        }
        return true;
      }
      case "queue-changed":
        if (this.#store.openTaskIds(event.snapshot.agentId).length > 0) this.changed(event.snapshot.agentId);
        return false;
      default:
        return false;
    }
  }

  #reportsTurn(task: AgentThreadRecord, event: AgentTurnCompletedEvent): boolean {
    if (!isStartedTask(task) || task.closedAt !== null) return false;
    if (event.origin === "user" && this.#mailbox.openRequestsHeldByTask(task.agentId, task.taskId).length === 0)
      return false;
    if (this.#mailbox.taskAwaitsAgent(task.agentId, task.taskId)) return false;
    const stopped = this.#stoppedTurns.get(task.taskId) === event.turnId;
    return !stopped || this.#userStops.get(task.taskId) === event.turnId;
  }

  #reportOnce(task: AgentThreadRecord, event: AgentTurnCompletedEvent): Effect.Effect<void> {
    this.#pendingReports.set(task.taskId, (this.#pendingReports.get(task.taskId) ?? 0) + 1);
    return this.#report(task, event).pipe(
      Effect.ensuring(
        Effect.sync(() => {
          const left = (this.#pendingReports.get(task.taskId) ?? 1) - 1;
          if (left > 0) this.#pendingReports.set(task.taskId, left);
          else this.#pendingReports.delete(task.taskId);
        }),
      ),
    );
  }

  readonly #report = Effect.fn("AgentTasks.report")(function* (
    this: AgentTasks,
    ended: AgentThreadRecord,
    event: AgentTurnCompletedEvent,
  ): Effect.fn.Return<void> {
    const task = this.#store.task(ended.taskId) ?? ended;
    this.#shownResults.delete(task.taskId);
    if (event.status === "completed")
      yield* this.#showTaskResults(task, event.turnId).pipe(
        Effect.catchCause((cause) =>
          Effect.sync(() =>
            logger.warn("Could not show task pages and files in the main chat.", { agentId: task.agentId, cause }),
          ),
        ),
      );
    const text = taskReportText(task, event.status, this.#hooks.turnAnswer(task.agentId, task.threadId, event.turnId));
    const queued = yield* this.#mailbox
      .enqueue({
        sender: { kind: "agent", agentId: task.agentId },
        requesterIds: this.#mailbox.taskRequesterIds(task.taskId),
        senderTaskId: task.taskId,
        heldRequestIds: this.#mailbox.openRequestsHeldByTask(task.agentId, task.taskId),
        recipientAgentIds: [task.agentId],
        text,
        replyToMessageId: null,
        expectsReply: false,
        idempotencyKey: `task-report:${event.turnId}`,
      })
      .pipe(
        Effect.as(true),
        Effect.catch((failure) =>
          Effect.sync(() => {
            logger.warn("Could not queue a task report.", { agentId: task.agentId, error: failure.cause });
            return false;
          }),
        ),
      );
    if (queued) this.#hooks.queued(task.agentId);
  });

  readonly #showTaskResults = Effect.fn("AgentTasks.showTaskResults")(function* (
    this: AgentTasks,
    task: AgentThreadRecord,
    turnId: string,
  ) {
    const threadId = this.#hooks.agent(task.agentId)?.threadId;
    if (!threadId) return;
    const shown = new Set(this.#conversation.ensureSnapshot(task.agentId, threadId).messages.map(({ id }) => id));
    const staged: string[] = [];
    yield* Effect.gen({ self: this }, function* () {
      const added: ConversationMessage[] = [];
      const copiedFiles = new Set<string>();
      for (const result of runResults(this.#conversation.ensureSnapshot(task.agentId, task.threadId).messages)) {
        const visual = chatVisualReply(result);
        const id = visual
          ? visualReplyMessageId(threadId, task.threadId, result.id)
          : responseAttachmentMessageId(threadId, task.threadId, result.id);
        if (shown.has(id)) continue;
        const copies: AttachmentSummary[] = [];
        for (const attachment of visual ? [visual.attachment] : (result.attachments ?? [])) {
          const digest = visual ? null : this.#mailbox.attachmentSha256(attachment.id);
          if (digest !== null && copiedFiles.has(digest)) continue;
          if (digest !== null) copiedFiles.add(digest);
          const file = yield* this.#mailbox.resolveAttachment(attachment.id);
          if (!file) continue;
          const copy = yield* this.#mailbox.stageGeneratedCopy({
            sourcePath: file.path,
            name: file.name,
            mimeType: file.mimeType,
            ownerAgentId: task.agentId,
            ownerThreadId: threadId,
          });
          staged.push(copy.id);
          copies.push(copy);
        }
        if (copies.length === 0) continue;
        added.push({
          id,
          author: "assistant",
          source: "assistant",
          text: visual ? result.text : "",
          createdAt: new Date().toISOString(),
          status: "completed",
          itemType: visual ? result.itemType : "agent_attachment",
          attachments: copies,
        });
      }
      if (added.length === 0) return;
      const chat = this.#conversation.ensureSnapshot(task.agentId, threadId);
      chat.messages.push(...added);
      sortConversationMessages(chat.messages);
      try {
        chat.revision = this.#mailbox.persistGeneratedAttachmentsWithConversation(
          chat,
          "attachment.task-pages-shown",
          { taskId: task.taskId, turnId },
          staged,
        ).revision;
      } catch (error) {
        for (const message of added) chat.messages.splice(chat.messages.indexOf(message), 1);
        throw error;
      }
      this.#conversation.publishConversation(chat);
      this.#shownResults.add(task.taskId);
    }).pipe(Effect.onError(() => this.#mailbox.discardStagedGeneratedAttachments(staged).pipe(Effect.ignore)));
  });

  #unfinishedTasks(agentId: string): number {
    return this.#store
      .openTaskIds(agentId)
      .flatMap((taskId) => this.#store.task(taskId) ?? [])
      .filter((task) => task.routineId === null && !this.#finished(task)).length;
  }

  #finished(task: AgentThreadRecord): boolean {
    return (
      !this.#conversation.loadedExecutionSnapshot(task.threadId)?.activeTurnId &&
      !this.#hooks.turnActive(task.agentId, task.threadId) &&
      !this.#mailbox.taskBusy(task.agentId, task.taskId)
    );
  }

  #taskOf(threadId: string | null): AgentThreadRecord | null {
    if (!threadId || !this.#conversation.isTaskThread(threadId)) return null;
    return this.#store.taskForThread(threadId);
  }

  #publicTask(
    task: AgentThreadRecord,
    work: ReadonlyMap<string, TaskWork>,
    awaited = this.#mailbox.awaitedThreadRequests(),
  ): AgentTask {
    const snapshot = this.#conversation.loadedExecutionSnapshot(task.threadId);
    const taskWork = task.closedAt === null ? work.get(task.taskId) : undefined;
    const activeTurnId = task.closedAt === null ? (snapshot?.activeTurnId ?? null) : null;
    const queuedMessages = (taskWork?.queuedMessages ?? []).map((message) => ({
      deliveryId: message.deliveryId,
      text: expandAttachmentReferences(message.text).slice(0, AGENT_TASK_QUEUED_PREVIEW),
      createdAt: message.createdAt,
    }));
    const running = activeTurnId !== null || taskWork?.active === true;
    const state =
      task.closedAt !== null ? "closed" : running ? "running" : queuedMessages.length > 0 ? "queued" : "idle";
    const hold = state === "queued" ? publicHold(this.#hooks.hold(task.agentId, task.taskId)) : null;
    return {
      id: task.taskId,
      agentId: task.agentId,
      threadId: task.threadId,
      origin: task.origin,
      title: fitAgentTaskTitle(task.title),
      state,
      outcome: task.outcome,
      hold,
      activeTurnId,
      progress: activeTurnId ? (this.#progress.get(task.taskId) ?? null) : null,
      error: task.outcome === "failed" ? task.error : null,
      queuedMessages,
      queue: taskWork?.queue ?? [],
      awaitedReplies: awaited.flatMap(({ taskId, messageId, recipientAgentId, status }) =>
        taskId === task.taskId && task.closedAt === null ? [{ messageId, recipientAgentId, status }] : [],
      ),
      createdAt: task.createdAt,
      updatedAt: task.updatedAt,
      closedAt: task.closedAt,
      branch: this.#publicBranch(task),
      routineId: task.routineId,
    };
  }

  #publicBranch(task: AgentThreadRecord): AgentTaskBranch | null {
    if (!task.branch) return null;
    const { sourceThreadId, sourceMessageId, throughMessageId } = task.branch;
    if (this.#hooks.agent(task.agentId)?.threadId === sourceThreadId)
      return { sourceTaskId: null, sourceTitle: null, sourceMessageId, throughMessageId };
    const source = this.#store.taskForThread(sourceThreadId);
    return {
      sourceTaskId: source?.taskId ?? sourceThreadId,
      sourceTitle: source ? fitAgentTaskTitle(source.title) : null,
      sourceMessageId,
      throughMessageId,
    };
  }
}

function runResults(messages: readonly ConversationMessage[]): ConversationMessage[] {
  const run = messages.slice(
    messages.findLastIndex((message) => message.author === "user" || message.author === "agent") + 1,
  );
  const pages = new Set(
    new Map(run.filter((message) => chatVisualReply(message)).map((page) => [page.text, page])).values(),
  );
  const files = new Map<string, AttachmentSummary[]>();
  let room: number = TASK_RESULT_FILES;
  for (const message of run.toReversed()) {
    if (room === 0) break;
    if (message.author !== "assistant" || message.status !== "completed") continue;
    if (chatVisualReply(message) || chatBackdropPage(message)) continue;
    const attachments = (message.attachments ?? []).slice(-room);
    if (attachments.length === 0) continue;
    files.set(message.id, attachments);
    room -= attachments.length;
  }
  return run.flatMap((message) => {
    if (pages.has(message)) return [message];
    const attachments = files.get(message.id);
    return attachments ? [{ ...message, attachments }] : [];
  });
}

function branchFiles(messages: readonly ConversationMessage[]): AttachmentSummary[] {
  return messages.flatMap((message) => [
    ...(message.attachments ?? []),
    ...(message.voiceRecording ? [message.voiceRecording] : []),
  ]);
}

const BRANCH_NUMBER_ROOM = 6;

function branchTitle(sourceTitle: string, titles: readonly string[]): string {
  const room = INPUT_LIMITS.agentTaskTitle - BRANCH_NUMBER_ROOM;
  const root = sourceTitle.length > room ? `${sourceTitle.slice(0, room - 1)}…` : sourceTitle;
  const prefix = `${root} #`;
  let last = 1;
  for (const title of titles) {
    const number = title.startsWith(prefix) ? title.slice(prefix.length) : "";
    if (/^\d{1,4}$/.test(number)) last = Math.max(last, Number(number));
  }
  return `${prefix}${last + 1}`;
}

function startedTaskResult(task: AgentThreadRecord, waiting: readonly string[]): OpenBotToolResponse {
  const note =
    "The task runs in its own conversation beside this chat, and the user can follow it in its tab. When its turn ends, OpenBot sends its final answer to your main chat as a task report. Start the other independent tasks now, do the quick parts yourself, tell the user in one sentence what runs, and end your turn. Do not wait for the task or read it to check progress.";
  return openBotToolResult({
    taskId: task.taskId,
    title: task.title,
    note:
      waiting.length === 0
        ? note
        : `${note} ${waiting.join(", ")} still wait for the result of their request: OpenBot sends them your answer to the task report as your reply. Do not send them a status or a result now.`,
  });
}

function messagedTaskResult(task: AgentThreadRecord, running: boolean): OpenBotToolResponse {
  return openBotToolResult({
    taskId: task.taskId,
    title: task.title,
    state: running ? "queued after the current turn of the task" : "sent",
    note: "The task answers in its own conversation, and OpenBot sends that answer to your main chat as a task report. Continue with other work or end your turn.",
  });
}

function isStartedTask(task: AgentThreadRecord): boolean {
  return task.origin === "agent" && task.routineId === null && task.branch === null;
}

function taskReportText(task: AgentThreadRecord, status: string, answer: string | null): string {
  const trimmed = answer?.trim();
  if (trimmed) return cutAnswer(trimmed);
  if (status === "failed" && task.error) return task.error.slice(0, TASK_REPORT_ERROR_LIMIT);
  return task.title;
}

function cutAnswer(answer: string): string {
  if (answer.length <= TASK_REPORT_ANSWER_LIMIT) return answer;
  return `${answer.slice(0, TASK_REPORT_ANSWER_LIMIT)}\n${TASK_REPORT_CUT_MARK}`;
}

function taskTitle(text: string): string {
  const line =
    expandAttachmentReferences(text)
      .split("\n")
      .map((part) => part.trim())
      .find((part) => part.length > 0) ?? "";
  return fitAgentTaskTitle(line);
}

function publicHold(reason: string | null): AgentTaskHold | null {
  switch (reason) {
    case null:
    case "providers-not-ready":
    case "provider-start":
      return null;
    case "task-limit":
      return "task-limit";
    case "agent-client-changing":
    case "provider-cli-replaced":
    case "endpoint-reload":
      return "agent-restarting";
    case "usage-limit":
      return "usage-limit";
    case "machine":
      return "server-busy";
    case "one-turn":
      return "one-turn";
    case "sign-in":
      return "sign-in";
    default:
      return "agent-busy";
  }
}
