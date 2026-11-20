import { createHash, randomUUID } from "node:crypto";
import { agentProviderDescriptor } from "@openbot/contracts/agent-providers";
import { expandAttachmentReferences } from "@openbot/contracts/attachment-references";
import { INPUT_LIMITS } from "@openbot/contracts/input-limits";
import {
  AGENT_TASK_QUEUED_PREVIEW,
  type AgentEvent,
  type AgentSummary,
  type AgentTask,
  type AgentTaskBranch,
  type AgentTaskHold,
  type AgentTasksSnapshot,
  type AttachmentSummary,
  agentTaskLimit,
  type BranchAgentTaskInput,
  type ConversationMessage,
  type ConversationSnapshot,
} from "@openbot/contracts/ipc";
import { sourceText } from "@openbot/i18n/source";
import { createOpenBotLogger } from "@openbot/logging";
import { Deferred, Effect, Schema, Semaphore } from "effect";
import { z } from "zod";
import type { ConversationRuntime } from "../agent/conversation-runtime";
import type { TaskLanes } from "../agent/drain-scheduler";
import { type OpenBotToolResponse, openBotToolFailure, openBotToolResult } from "../agent/routine-tools";
import { ToolOperationFailed } from "../agent/tool-operation";
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

export const startTaskToolSchema = z.strictObject({
  title: z.string().trim().min(1).max(INPUT_LIMITS.agentTaskTitle),
  brief: z.string().trim().min(1).max(INPUT_LIMITS.messageText),
});

export interface AgentTasksHooks {
  emit(event: AgentEvent): void;
  agent(agentId: string): AgentSummary | undefined;
  defaultTaskLimit(): number;
  hold(agentId: string, taskId: string): string | null;
  queued(agentId: string): void;
  turnActive(agentId: string, threadId: string): boolean;
  archived(agentId: string, tasks: readonly AgentThreadRecord[]): Effect.Effect<void>;
}

export interface AgentTaskCaller {
  agentId: string;
  inExecutionThread: boolean;
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
  readonly #progressPublish = new Map<string, NodeJS.Timeout>();
  readonly #turnEndWaiters = new Map<string, Set<Deferred.Deferred<void>>>();
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
    if (existing?.closedAt === null) {
      this.#conversation.registerTaskThread(agentId, existing.threadId);
      return this.#followRoutineName(existing, title);
    }
    if (this.#store.openTaskIds(agentId).length >= INPUT_LIMITS.agentTasks) return null;
    if (existing) {
      this.reopen(existing);
      const reopened = this.#store.task(existing.taskId);
      return reopened ? this.#followRoutineName(reopened, title) : null;
    }
    if (!title) return null;
    const task = this.#store.create({ agentId, origin: "agent", title, titleSource: "agent", routineId });
    this.#conversation.registerTaskThread(agentId, task.threadId);
    this.changed(agentId);
    return task;
  }

  #followRoutineName(thread: AgentThreadRecord, title: string | null): AgentThreadRecord {
    if (!title || thread.title === title || thread.titleSource === "user") return thread;
    this.#store.retitle(thread.threadId, title);
    this.changed(thread.agentId);
    return this.#store.task(thread.taskId) ?? thread;
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

  markStopped(taskId: string, turnId: string): void {
    this.#stoppedTurns.set(taskId, turnId);
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
    }
    this.#store.deleteForAgent(agentId);
  }

  readonly handleTool = Effect.fn("AgentTasks.handleTool")(function* (
    this: AgentTasks,
    params: DynamicToolCallParams,
    caller: AgentTaskCaller,
  ): Effect.fn.Return<OpenBotToolResponse | null> {
    if (params.tool !== START_TASK_TOOL) return null;
    const parsed = startTaskToolSchema.safeParse(params.arguments);
    if (!parsed.success) return openBotToolFailure(sourceText("error.backend.taskToolInvalid"));
    if (caller.inExecutionThread) return openBotToolFailure(sourceText("error.backend.taskOwnChatOnly"));
    return yield* this.#starts.withPermit(this.#start(params, caller, parsed.data));
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
    if (startedTask) return startedTaskResult(startedTask);
    const prepared = yield* this.#preparedAgentTask(caller.agentId, input.title);
    if ("refusal" in prepared) return openBotToolFailure(prepared.refusal);
    const { task, archived } = prepared;
    const queued = yield* this.#mailbox
      .enqueue({
        sender: { kind: "agent", agentId: caller.agentId },
        taskId: task.taskId,
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
    if (!queued) {
      this.discard(task);
      if (archived.length > 0) this.changed(caller.agentId);
      return openBotToolFailure(sourceText("error.backend.taskStartFailed"));
    }
    this.changed(caller.agentId);
    this.#hooks.queued(caller.agentId);
    return startedTaskResult(task);
  });

  /**
   * Checks the limits of a task that an agent starts, gives room by archiving its oldest finished
   * ones, and creates the task. A refusal carries the localized message that the caller reports: the
   * `start_task` tool returns it, and a teammate's new-thread send fails with it to its tool router.
   * Calls run in the `#starts` permit of their caller.
   */
  readonly #preparedAgentTask = Effect.fn("AgentTasks.preparedAgentTask")(function* (
    this: AgentTasks,
    agentId: string,
    title: string,
  ): Effect.fn.Return<{ task: AgentThreadRecord; archived: AgentThreadRecord[] } | { refusal: string }> {
    const open = this.#store.openTaskIds(agentId).flatMap((taskId) => this.#store.task(taskId) ?? []);
    const finished = open.filter((task) => this.#finished(task));
    // A routine thread is the routine's own: its runs do not count as tasks that the agent started.
    const unfinishedTasks = open.filter((task) => task.routineId === null && !finished.includes(task)).length;
    if (unfinishedTasks >= AGENT_STARTED_UNFINISHED_TASKS)
      return {
        refusal: sourceText("error.backend.taskUnfinishedLimit", { count: AGENT_STARTED_UNFINISHED_TASKS }),
      };
    // The newest finished tasks that the agent started stay open, when the task list has a place for them
    // and for the new task. The person's own tasks, branches and routine threads stay open.
    const finishedByAgent = finished
      .filter((task) => task.origin === "agent" && task.branch === null && task.routineId === null)
      .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt));
    const others = open.length - finishedByAgent.length;
    const kept = Math.max(0, Math.min(AGENT_STARTED_FINISHED_KEPT, INPUT_LIMITS.agentTasks - 1 - others));
    const archived = finishedByAgent.slice(kept);
    if (open.length - archived.length >= INPUT_LIMITS.agentTasks)
      return { refusal: sourceText("error.backend.threadOpenLimitReached", { count: INPUT_LIMITS.agentTasks }) };
    // All of them close before the first yield, so no turn starts between the check and the close.
    for (const task of archived) this.#closeQuietly(task);
    const task = this.create(agentId, title, "agent");
    if (archived.length > 0) yield* this.#hooks.archived(agentId, archived);
    return { task, archived };
  });

  /**
   * The side thread that one recipient's independent teammate message runs in: the recipient owns it,
   * and the title is the message's first line. It takes the same limits and archival as `start_task`,
   * so a thread that another agent starts cannot fill the task list past it (#8134). A refusal or an
   * empty title fails, because the caller is a tool path that reports the failure's message.
   */
  /**
   * Runs one new-thread teammate send in the `start_task` permit, so its check, create and deliver
   * of every recipient stays serialized against the other starts (#8134). A retried or concurrent
   * call of the same tool call therefore reads the message that the first one delivered.
   */
  readonly withTeammatePermit = <A, E, R>(effect: Effect.Effect<A, E, R>): Effect.Effect<A, E, R> =>
    this.#starts.withPermit(effect);

  /**
   * The side thread that one recipient's independent teammate message runs in: the recipient owns it,
   * and the title is the message's first line. It takes the same limits and archival as `start_task`,
   * so a thread that another agent starts cannot fill the task list past it (#8134). The caller holds
   * the `withTeammatePermit` permit, so a refusal fails instead of taking the permit itself.
   */
  readonly preparedTeammateThread = Effect.fn("AgentTasks.preparedTeammateThread")(function* (
    this: AgentTasks,
    agentId: string,
    text: string,
  ): Effect.fn.Return<AgentThreadRecord, ToolOperationFailed> {
    const title = taskTitle(text);
    if (!title)
      return yield* Effect.fail(
        new ToolOperationFailed({ cause: new Error(sourceText("error.backend.threadTitleRequired")) }),
      );
    const prepared = yield* this.#preparedAgentTask(agentId, title);
    if ("refusal" in prepared)
      return yield* Effect.fail(new ToolOperationFailed({ cause: new Error(prepared.refusal) }));
    return prepared.task;
  });

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
        if (task.error !== null) this.#store.setError(task.taskId, null);
        this.#store.touch(task.taskId);
        this.changed(task.agentId);
        return true;
      }
      case "turn-completed": {
        const task = this.#taskOf(event.threadId);
        if (!task) return false;
        this.#progress.delete(task.taskId);
        this.#store.setOutcome(
          task.taskId,
          event.status === "completed" ? "completed" : event.status === "failed" ? "failed" : "interrupted",
        );
        this.changed(task.agentId);
        const waiters = this.#turnEndWaiters.get(task.taskId);
        this.#turnEndWaiters.delete(task.taskId);
        for (const ended of waiters ?? []) Deferred.doneUnsafe(ended, Effect.void);
        if (!event.quiet && !event.continues)
          this.#hooks.emit({
            type: "thread-turn-completed",
            taskId: task.taskId,
            routine: task.routineId !== null,
            turn: event,
          });
        return true;
      }
      case "queue-changed":
        if (this.#store.openTaskIds(event.snapshot.agentId).length > 0) this.changed(event.snapshot.agentId);
        return false;
      default:
        return false;
    }
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
      title: task.title,
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
      sourceTitle: source?.title ?? null,
      sourceMessageId,
      throughMessageId,
    };
  }
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

function startedTaskResult(task: AgentThreadRecord): OpenBotToolResponse {
  return openBotToolResult({
    taskId: task.taskId,
    title: task.title,
    note: "The task runs in its own conversation beside this chat, and the user follows it in the task list. Its result stays in the task: you do not receive it here. Tell the user in one sentence that the task started, and continue with other work or end your turn.",
  });
}

function taskTitle(text: string): string {
  const line =
    expandAttachmentReferences(text)
      .split("\n")
      .map((part) => part.trim())
      .find((part) => part.length > 0) ?? "";
  return line.length > INPUT_LIMITS.agentTaskTitle ? `${line.slice(0, INPUT_LIMITS.agentTaskTitle - 1)}…` : line;
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
      return "agent-restarting";
    case "usage-limit":
      return "usage-limit";
    case "machine":
      return "server-busy";
    case "one-turn":
      return "one-turn";
    default:
      return "agent-busy";
  }
}
