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
import {
  type AgentThreadOrigin,
  type AgentThreadRecord,
  type AgentThreadStore,
  copyBranchMessages,
} from "../agent-threads/agent-thread-store";
import type { MailboxStore } from "../mailbox-store";
import type { DynamicToolCallParams } from "../protocol";
import { storedSync } from "../stored-state-effects";

const logger = createOpenBotLogger("agent-tasks");

/**
 * The most unfinished tasks that an agent can have when it starts one more itself. A finished task does
 * not count. The user can have up to `INPUT_LIMITS.agentTasks` open tasks.
 */
const AGENT_STARTED_UNFINISHED_TASKS = 8;

/**
 * The finished tasks that the agent started and that stay open when it starts one more. The older ones
 * are archived, so a routine that starts a task each run does not fill the task list.
 */
const AGENT_STARTED_FINISHED_KEPT = 8;

export const START_TASK_TOOL = "start_task";

export const startTaskToolSchema = z.strictObject({
  title: z.string().trim().min(1).max(INPUT_LIMITS.agentTaskTitle),
  brief: z.string().trim().min(1).max(INPUT_LIMITS.messageText),
});

export interface AgentTasksHooks {
  emit(event: AgentEvent): void;
  /** The agent, for its provider and its task limit. */
  agent(agentId: string): AgentSummary | undefined;
  /** Why the drain holds the next message of this task, as the drain names it, or null. Read late. */
  hold(agentId: string, taskId: string): string | null;
  /** A message is queued in a task: the queue and the drain take it. */
  queued(agentId: string): void;
  /** The stored active turn of a thread, also when its conversation is not loaded. */
  turnActive(agentId: string, threadId: string): boolean;
  /** OpenBot archived finished tasks of one agent: their memory reviews start, and a waiting task lane can start. */
  archived(agentId: string, tasks: readonly AgentThreadRecord[]): Effect.Effect<void>;
}

/** Where `start_task` was called, as the tool router knows it. */
export interface AgentTaskCaller {
  agentId: string;
  /** A channel, messaging or task turn: only the agent's own chat starts a task. */
  inExecutionThread: boolean;
}

/** Why a branch was not made. The cause holds the localized message for the person. */
export class AgentTaskBranchFailed extends Schema.TaggedError<AgentTaskBranchFailed>()("AgentTaskBranchFailed", {
  reason: Schema.Literals(["source-not-found", "source-busy", "message-not-found", "thread-limit", "storage"]),
  cause: Schema.Defect(),
}) {}

type BranchFailure = AgentTaskBranchFailed["reason"];

function branchStep<A>(reason: BranchFailure, run: () => A): Effect.Effect<A, AgentTaskBranchFailed> {
  return Effect.try({ try: run, catch: (cause) => new AgentTaskBranchFailed({ reason, cause }) });
}

export interface AgentTasksOptions {
  store: AgentThreadStore;
  mailbox: MailboxStore;
  conversation: ConversationRuntime;
  hooks: AgentTasksHooks;
}

/**
 * Owns the tasks of each agent: conversations with their own thread and provider session that run
 * beside the agent's own chat. It gives the drain one lane per open task, keeps the events of task
 * threads out of the agent's own chat, and builds the task list that the Tasks tab of the side panel shows.
 *
 * It never imports the agent service facade.
 */
export class AgentTasks implements TaskLanes {
  readonly #store: AgentThreadStore;
  readonly #mailbox: MailboxStore;
  readonly #conversation: ConversationRuntime;
  readonly #hooks: AgentTasksHooks;
  /** The last progress line of each running task turn, by task id. */
  readonly #progress = new Map<string, string>();
  /** The last turn of each task that the user stopped, by task id. */
  readonly #stoppedTurns = new Map<string, string>();
  /** Who waits for the running turn of a task to end, by task id. */
  readonly #turnEndWaiters = new Map<string, Set<Deferred.Deferred<void>>>();
  /** One branch is made at a time, so a retry that arrives during the first call finds its branch. */
  readonly #branches = Semaphore.makeUnsafe(1);
  /** One `start_task` call runs at a time, so parallel calls in one turn cannot pass the task limits. */
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
    return agent ? agentTaskLimit(agent) : 1;
  }

  /** Whether the agent's provider runs one turn at a time, across its own chat and its tasks. */
  oneTurnAtATime(agentId: string): boolean {
    const agent = this.#hooks.agent(agentId);
    return agent !== undefined && !agentProviderDescriptor(agent.provider).concurrentTurns;
  }

  /** The error of a task turn, redacted by the caller. The panel shows it until the next turn starts. */
  failed(taskId: string, message: string): void {
    const task = this.#store.task(taskId);
    if (!task) return;
    this.#store.setError(taskId, message.slice(0, INPUT_LIMITS.agentTaskError));
    this.changed(task.agentId);
  }

  snapshot(agentId: string): AgentTasksSnapshot {
    return {
      agentId,
      tasks: this.#store.list(agentId).map((task) => this.#publicTask(task)),
      limit: this.limit(agentId),
    };
  }

  /** The task's conversation. Its thread loads here, also for a task that no turn has used since boot. */
  read(agentId: string, taskId: string): ConversationSnapshot {
    const task = this.#store.task(taskId);
    if (!task || task.agentId !== agentId) throw new Error(sourceText("error.backend.threadNotFound"));
    this.#conversation.registerTaskThread(agentId, task.threadId);
    return this.#conversation.ensureSnapshot(agentId, task.threadId);
  }

  /** The open task of this agent, ready for a message. */
  requireOpen(agentId: string, taskId: string): AgentThreadRecord {
    const task = this.#store.task(taskId);
    if (!task || task.agentId !== agentId) throw new Error(sourceText("error.backend.threadNotFound"));
    if (task.closedAt !== null) throw new Error(sourceText("error.backend.threadArchived"));
    this.#conversation.registerTaskThread(agentId, task.threadId);
    return task;
  }

  /** The side threads of this agent, open and archived, with activity at or after `after`. The latest first. */
  recent(agentId: string, after: string | null, limit: number): AgentThreadRecord[] {
    return this.#store.recent(agentId, after, limit);
  }

  /** Whether this agent has the task, open or closed. */
  has(agentId: string, taskId: string): boolean {
    return this.#store.task(taskId)?.agentId === agentId;
  }

  /** A task of this agent, open or closed. */
  require(agentId: string, taskId: string): AgentThreadRecord {
    const task = this.#store.task(taskId);
    if (!task || task.agentId !== agentId) throw new Error(sourceText("error.backend.threadNotFound"));
    return task;
  }

  /** The title is the first line of the message that starts the task. */
  create(agentId: string, text: string, origin: AgentThreadOrigin): AgentThreadRecord {
    const title = taskTitle(text);
    if (!title) throw new Error(sourceText("error.backend.threadTitleRequired"));
    this.#requireRoom(agentId);
    const task = this.#store.create({ agentId, origin, title, titleSource: origin === "agent" ? "agent" : "auto" });
    this.#conversation.registerTaskThread(agentId, task.threadId);
    return task;
  }

  /**
   * The open thread that takes the runs of this routine. It is made at the first run and restored when
   * it was archived. Null when the task list has no room: the run then goes to the agent's own chat.
   */
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

  /** A routine thread takes the routine's new name, unless a person renamed the thread. */
  #followRoutineName(thread: AgentThreadRecord, title: string | null): AgentThreadRecord {
    if (!title || thread.title === title || thread.titleSource === "user") return thread;
    this.#store.retitle(thread.threadId, title);
    this.changed(thread.agentId);
    return this.#store.task(thread.taskId) ?? thread;
  }

  /** The thread belongs to a routine: each run of the routine starts a new session in it. */
  isRoutineThread(taskId: string): boolean {
    return (this.#store.task(taskId)?.routineId ?? null) !== null;
  }

  /** The thread of this routine, open or archived, or null before its first run. */
  threadOfRoutine(agentId: string, routineId: string): AgentThreadRecord | null {
    return this.#store.threadForRoutine(agentId, routineId);
  }

  /**
   * Makes a branch: a new side thread with a copy of a conversation of the agent, through the turn of
   * the chosen message. The files of the copied messages are copied as files of the branch, so they
   * stay when the source is deleted. No turn starts. A retry with the same request id returns the
   * branch that the first call made, also with no new copies of the files.
   */
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
        // A file that is gone keeps its card as it is in the source.
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
      // Copies that no committed branch names are removed.
      Effect.onError(() => this.#mailbox.discardStagedGeneratedAttachments(staged).pipe(Effect.ignore)),
    );
    this.#conversation.registerTaskThread(record.agentId, record.threadId);
    return record;
  });

  /** The thread that a branch copies, its title for a side thread, and whether a turn runs in it. */
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
      // The " #N" of a branch title came from a branch. A title that a person wrote keeps its number.
      title: task.branch && task.titleSource === "auto" ? task.title.replace(/ #\d+$/, "") : task.title,
      running:
        Boolean(this.#conversation.loadedExecutionSnapshot(task.threadId)?.activeTurnId) ||
        this.#mailbox.laneActive(task.agentId, task.taskId),
    };
  }

  /** The task list holds `INPUT_LIMITS.agentTasks` tasks, open ones first, so more open tasks could not be seen or stopped. */
  #requireRoom(agentId: string): void {
    if (this.#store.openTaskIds(agentId).length >= INPUT_LIMITS.agentTasks)
      throw new Error(sourceText("error.backend.threadOpenLimitReached", { count: INPUT_LIMITS.agentTasks }));
  }

  /** Removes a new task that took no message, because the move into it was refused. */
  discard(task: AgentThreadRecord): void {
    this.#conversation.forgetExecutionThread(task.threadId);
    this.#store.delete(task.taskId);
  }

  /** A rename by a person: trimmed, and kept when later messages arrive. */
  rename(task: AgentThreadRecord, title: string): void {
    const trimmed = title.trim();
    if (!trimmed || trimmed.length > INPUT_LIMITS.agentTaskTitle)
      throw new Error(sourceText("error.backend.threadTitleRequired"));
    this.#store.rename(task.threadId, trimmed);
    this.changed(task.agentId);
  }

  /**
   * Removes the thread with its conversation. The caller stops its turn, cancels its queued messages
   * and releases its provider sessions first.
   */
  delete(task: AgentThreadRecord): void {
    this.#progress.delete(task.taskId);
    this.#stoppedTurns.delete(task.taskId);
    this.#turnEndWaiters.delete(task.taskId);
    this.#store.delete(task.taskId);
    this.changed(task.agentId);
  }

  /** The task as the task list shows it. */
  publicTask(task: AgentThreadRecord): AgentTask {
    return this.#publicTask(task);
  }

  close(task: AgentThreadRecord): void {
    this.#closeQuietly(task);
    this.changed(task.agentId);
  }

  /** Closes the task and sends no event, so a caller that closes many sends one. */
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

  /**
   * Ends when the next turn of this task ends. The wait starts at this call, not when the Effect runs,
   * so a caller that sends a Stop after this call cannot miss the end.
   */
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

  /** The turn that a Stop asked to end: a message sent to the task does not steer into it. */
  markStopped(taskId: string, turnId: string): void {
    this.#stoppedTurns.set(taskId, turnId);
  }

  stoppedTurn(taskId: string): string | null {
    return this.#stoppedTurns.get(taskId) ?? null;
  }

  /** The agent id and thread id of every task, for boot recovery. */
  executionThreads(): Array<{ id: string; threadId: string }> {
    return this.#store.executionThreads();
  }

  /** The agent id and thread id of every open task, the newest first. */
  openExecutionThreads(): Array<{ id: string; threadId: string }> {
    return this.#store.openExecutionThreads();
  }

  /**
   * The thread of the task that a delivery runs in, also when the task is archived, or null for the
   * agent's own chat. Work of an archived task must never settle in the agent's own chat. The work of
   * a deleted task ends at boot (`endWorkOfGoneTasks`), and a delete waits until its task is idle.
   */
  threadForDelivery(deliveryId: string): string | null {
    const taskId = this.#mailbox.taskIdForDelivery(deliveryId);
    return taskId ? (this.#store.task(taskId)?.threadId ?? null) : null;
  }

  /** Whether a delivery names a task that no longer exists. */
  deliveryTaskGone(deliveryId: string): boolean {
    const taskId = this.#mailbox.taskIdForDelivery(deliveryId);
    return taskId !== null && this.#store.task(taskId) === null;
  }

  /**
   * Ends the work of each task whose thread is gone: a queued message is cancelled, and a started one
   * is interrupted. The rows stay. Migration 47 did not copy a task whose agent was gone, so its
   * queued message would otherwise wait forever and keep the agent busy. Runs at boot, before the
   * recovery reads the provider history. Returns the agents whose queue changed.
   */
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

  /**
   * A side thread of this agent that the person opened or branched. A routine thread and a thread
   * that the agent started with `start_task` are not.
   */
  isPersonThread(agentId: string, threadId: string): boolean {
    const thread = this.#store.taskForThread(threadId);
    return thread?.agentId === agentId && thread.origin === "user" && thread.routineId === null;
  }

  isBranchThread(threadId: string): boolean {
    return Boolean(this.#store.taskForThread(threadId)?.branch);
  }

  /** Whether the thread takes the runs of a routine. One read, by thread id. */
  isRoutineThreadId(threadId: string): boolean {
    return (this.#store.taskForThread(threadId)?.routineId ?? null) !== null;
  }

  taskForThread(threadId: string): string | null {
    return this.#store.taskForThread(threadId)?.taskId ?? null;
  }

  /** The task threads of this agent. The caller releases their provider sessions before `deleteForAgent`. */
  threadIdsForAgent(agentId: string): string[] {
    return this.#store.threadIdsForAgent(agentId);
  }

  deleteForAgent(agentId: string): void {
    for (const taskId of this.#store.taskIdsForAgent(agentId)) {
      this.#progress.delete(taskId);
      this.#stoppedTurns.delete(taskId);
    }
    this.#store.deleteForAgent(agentId);
  }

  /**
   * Answers `start_task`; null for every other tool. The brief is the task's first message, sent by
   * the agent to itself, so the task conversation shows the agent as its author. A retried call
   * returns the task that the first call started.
   */
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

  /**
   * Starts the task of one `start_task` call. Calls run one at a time, so the count of unfinished
   * tasks includes the task of an earlier call, and a retry finds the task that the first call started.
   */
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
    const open = this.#store.openTaskIds(caller.agentId).flatMap((taskId) => this.#store.task(taskId) ?? []);
    const finished = open.filter((task) => this.#finished(task));
    // A routine thread is the routine's own: its runs do not count as tasks that the agent started.
    const unfinishedTasks = open.filter((task) => task.routineId === null && !finished.includes(task)).length;
    if (unfinishedTasks >= AGENT_STARTED_UNFINISHED_TASKS)
      return openBotToolFailure(
        sourceText("error.backend.taskUnfinishedLimit", { count: AGENT_STARTED_UNFINISHED_TASKS }),
      );
    // The newest finished tasks that the agent started stay open, when the task list has a place for them
    // and for the new task. The person's own tasks, branches and routine threads stay open.
    const finishedByAgent = finished
      .filter((task) => task.origin === "agent" && task.branch === null && task.routineId === null)
      .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt));
    const others = open.length - finishedByAgent.length;
    const kept = Math.max(0, Math.min(AGENT_STARTED_FINISHED_KEPT, INPUT_LIMITS.agentTasks - 1 - others));
    const archived = finishedByAgent.slice(kept);
    if (open.length - archived.length >= INPUT_LIMITS.agentTasks)
      return openBotToolFailure(sourceText("error.backend.threadOpenLimitReached", { count: INPUT_LIMITS.agentTasks }));
    // All of them close before the first yield, so no turn starts between the check and the close.
    for (const task of archived) this.#closeQuietly(task);
    const task = this.create(caller.agentId, input.title, "agent");
    if (archived.length > 0) yield* this.#hooks.archived(caller.agentId, archived);
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

  changed(agentId: string): void {
    this.#hooks.emit({ type: "agent-tasks-changed", snapshot: this.snapshot(agentId) });
  }

  /**
   * Takes the events of task threads: they reach the task's panel, never the agent's own chat.
   * True when the event was taken. A prompt or an approval of a task turn passes. Its `threadId` is the
   * task's thread, so the task's panel shows it and the agent's chat leaves it out.
   */
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
        this.changed(task.agentId);
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
        // The waiters leave the map here, so a wait that a failed Stop never runs does not stay.
        const waiters = this.#turnEndWaiters.get(task.taskId);
        this.#turnEndWaiters.delete(task.taskId);
        for (const ended of waiters ?? []) Deferred.doneUnsafe(ended, Effect.void);
        // A routine run in the agent's chat notified. In its own thread it notifies the same way, but
        // through its own event, so the agent's chat keeps its turn state.
        if (task.routineId !== null && !event.quiet && !event.continues)
          this.#hooks.emit({ type: "routine-thread-turn-completed", taskId: task.taskId, turn: event });
        return true;
      }
      case "queue-changed":
        // A queued task message changes the task's state, and the drain's reason to hold it.
        if (this.#store.openTaskIds(event.snapshot.agentId).length > 0) this.changed(event.snapshot.agentId);
        return false;
      default:
        return false;
    }
  }

  /** No turn runs in the task, and no message is queued for it. */
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

  #publicTask(task: AgentThreadRecord): AgentTask {
    const snapshot = this.#conversation.loadedExecutionSnapshot(task.threadId);
    const activeTurnId = task.closedAt === null ? (snapshot?.activeTurnId ?? null) : null;
    const queuedMessages =
      task.closedAt === null
        ? this.#mailbox.queuedTaskMessages(task.agentId, task.taskId).map((message) => ({
            deliveryId: message.deliveryId,
            text: expandAttachmentReferences(message.text).slice(0, AGENT_TASK_QUEUED_PREVIEW),
            createdAt: message.createdAt,
          }))
        : [];
    const running = activeTurnId !== null || this.#mailbox.laneActive(task.agentId, task.taskId);
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
      queue: task.closedAt === null ? this.#mailbox.taskQueue(task.agentId, task.taskId) : [],
      createdAt: task.createdAt,
      updatedAt: task.updatedAt,
      closedAt: task.closedAt,
      branch: this.#publicBranch(task),
      routineId: task.routineId,
    };
  }

  /** The source is a task id, or null for the agent's own chat. A deleted source keeps its thread id. */
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

/** The files of the copied messages: attachments and voice recordings. */
function branchFiles(messages: readonly ConversationMessage[]): AttachmentSummary[] {
  return messages.flatMap((message) => [
    ...(message.attachments ?? []),
    ...(message.voiceRecording ? [message.voiceRecording] : []),
  ]);
}

/** Room for " #9999" after the source title. */
const BRANCH_NUMBER_ROOM = 6;

/**
 * The title of a branch of a side thread: the source title, then the next number after those that the
 * agent's threads already use, from #2.
 */
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

/** The first line of the text, cut to the title limit. An attachment reference shows as its file name. */
function taskTitle(text: string): string {
  const line =
    expandAttachmentReferences(text)
      .split("\n")
      .map((part) => part.trim())
      .find((part) => part.length > 0) ?? "";
  return line.length > INPUT_LIMITS.agentTaskTitle ? `${line.slice(0, INPUT_LIMITS.agentTaskTitle - 1)}…` : line;
}

/** The drain names more reasons than the user needs: the ones a task cannot change become "agent-busy". */
function publicHold(reason: string | null): AgentTaskHold | null {
  switch (reason) {
    case null:
      return null;
    case "task-limit":
      return "task-limit";
    case "agent-client-changing":
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
