import { createHash } from "node:crypto";
import { agentProviderDescriptor } from "@openbot/contracts/agent-providers";
import { expandAttachmentReferences } from "@openbot/contracts/attachment-references";
import { INPUT_LIMITS } from "@openbot/contracts/input-limits";
import {
  AGENT_TASK_QUEUED_PREVIEW,
  type AgentEvent,
  type AgentSummary,
  type AgentTask,
  type AgentTaskHold,
  type AgentTasksSnapshot,
  agentTaskLimit,
  type ConversationSnapshot,
} from "@openbot/contracts/ipc";
import { sourceText } from "@openbot/i18n/source";
import { createOpenBotLogger } from "@openbot/logging";
import { Deferred, Effect } from "effect";
import { z } from "zod";
import type { ConversationRuntime } from "../agent/conversation-runtime";
import type { TaskLanes } from "../agent/drain-scheduler";
import { type OpenBotToolResponse, openBotToolFailure, openBotToolResult } from "../agent/routine-tools";
import type { AgentThreadOrigin, AgentThreadRecord, AgentThreadStore } from "../agent-threads/agent-thread-store";
import type { MailboxStore } from "../mailbox-store";
import type { DynamicToolCallParams } from "../protocol";
import { storedSync } from "../stored-state-effects";

const logger = createOpenBotLogger("agent-tasks");

/** The most open tasks that an agent can have when it starts one more itself. The user can have up to `INPUT_LIMITS.agentTasks`. */
const AGENT_STARTED_OPEN_TASKS = 8;

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
}

/** Where `start_task` was called, as the tool router knows it. */
export interface AgentTaskCaller {
  agentId: string;
  /** A channel, messaging or task turn: only the agent's own chat starts a task. */
  inExecutionThread: boolean;
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
    this.#store.close(task.taskId);
    this.#progress.delete(task.taskId);
    this.#stoppedTurns.delete(task.taskId);
    this.changed(task.agentId);
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
    const idempotencyKey = `start-task:${createHash("sha256")
      .update(JSON.stringify([caller.agentId, params.turnId, params.callId]))
      .digest("hex")}`;
    const started = this.#mailbox.deliveryForKey(idempotencyKey);
    const startedTaskId = started ? this.#mailbox.taskIdForDelivery(started.delivery.id) : null;
    const startedTask = startedTaskId ? this.#store.task(startedTaskId) : null;
    if (startedTask) return startedTaskResult(startedTask);
    const open = this.#store.openTaskIds(caller.agentId).length;
    if (open >= AGENT_STARTED_OPEN_TASKS)
      return openBotToolFailure(sourceText("error.backend.taskOpenLimit", { count: AGENT_STARTED_OPEN_TASKS }));
    const task = this.create(caller.agentId, parsed.data.title, "agent");
    const queued = yield* this.#mailbox
      .enqueue({
        sender: { kind: "agent", agentId: caller.agentId },
        taskId: task.taskId,
        recipientAgentIds: [caller.agentId],
        text: parsed.data.brief,
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
      createdAt: task.createdAt,
      updatedAt: task.updatedAt,
      closedAt: task.closedAt,
    };
  }
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
