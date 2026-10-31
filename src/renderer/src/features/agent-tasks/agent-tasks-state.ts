import type {
  AgentEvent,
  AgentTask,
  AgentTaskBranch,
  AgentTasksSnapshot,
  ConversationSnapshot,
} from "@openbot/contracts/ipc";
import type { AppTextKey } from "@openbot/i18n";
import { currentText } from "@openbot/ui/text";
import { createEffect, createStore, untrack } from "solid-js";
import { actionToast } from "../../action-toast";
import { desktopAnalytics } from "../../analytics";
import { createScopeGuard } from "../../scope-lifetime";
import type { AgentTasksPort } from "./agent-tasks-port";

export type AgentTaskEvent = Extract<
  AgentEvent,
  { type: "agent-tasks-changed" | "agent-task-conversation" | "agent-task-conversation-delta" }
>;

/** A task event of a host. Other events do not change a side thread. */
export function isAgentTaskEvent(event: { type: string }): event is AgentTaskEvent {
  return (
    event.type === "agent-tasks-changed" ||
    event.type === "agent-task-conversation" ||
    event.type === "agent-task-conversation-delta"
  );
}

interface AgentTasksState {
  /** The task list of each agent that loaded one, by agent id. */
  snapshots: Record<string, AgentTasksSnapshot>;
  /** The conversation of each task that loaded one, by task id. */
  conversations: Record<string, ConversationSnapshot>;
}

export interface AgentTasksOptions {
  /** Read on each call: tests and stories replace the port per case. */
  port: () => AgentTasksPort;
  activeAgentId: () => string | undefined;
  /** The server is this computer. Only this computer moves a queued message to a new thread. */
  local: () => boolean;
  /** The server has side threads: the `agent-tasks-v1` routes. */
  available: () => boolean;
  /** The server renames and deletes side threads: the `agent-threads-v1` routes. */
  editable: () => boolean;
  /** The server keeps the person's read mark of each side thread: the `agent-thread-reads-v1` routes. */
  readable: () => boolean;
  /**
   * The server copies a conversation into a new thread: this computer, or the `agent-thread-branches-v1`
   * routes. The list of such a server gives the link of each branch; its events do not.
   */
  branchable: () => boolean;
  /**
   * A change of this value reads the lists of the active agent and of each agent with a running thread
   * again, for example when the agent starts again.
   */
  reloadKey: () => unknown;
}

/**
 * The side threads of each agent on one server: their list, the conversation of each opened thread,
 * and the thread actions. A side thread is a task of the `agent-tasks-v1` routes. Only the active
 * agent's list loads; an `agent-tasks-changed` event updates any agent. Make it in the owner of the
 * server: a reply that arrives after that owner ends changes nothing.
 */
export function createAgentTasks(options: AgentTasksOptions) {
  const { port, activeAgentId, local, available, editable, readable, branchable } = options;
  const scopeIsCurrent = createScopeGuard();
  const [state, setState] = createStore<AgentTasksState>({ snapshots: {}, conversations: {} });
  const listRequests = new Map<string, number>();
  const readRequests = new Map<string, number>();
  /** The message that each thread's read mark last moved to, so a redraw does not send the same mark again. */
  const readMarks = new Map<string, string>();

  /**
   * Stores a thread list. A conversation of a thread that the list no longer has goes with it. A task
   * without `branch` keeps the link that the stored list has: an `agent-tasks-changed` event of a joined
   * server does not carry it, and a link does not change.
   */
  function setSnapshot(snapshot: AgentTasksSnapshot): void {
    const ids = new Set(snapshot.tasks.map((task) => task.id));
    // An event handler runs this too: the stored list is input here, not a dependency.
    const links = untrack(() => {
      const stored = new Map<string, AgentTaskBranch>();
      for (const task of state.snapshots[snapshot.agentId]?.tasks ?? []) {
        if (task.branch) stored.set(task.id, { ...task.branch });
      }
      return stored;
    });
    const tasks = snapshot.tasks.map((task) => {
      const branch = task.branch === undefined ? links.get(task.id) : undefined;
      return branch ? { ...task, branch } : task;
    });
    setState((current) => {
      current.snapshots[snapshot.agentId] = { ...snapshot, tasks };
      for (const [taskId, conversation] of Object.entries(current.conversations)) {
        if (conversation.agentId === snapshot.agentId && !ids.has(taskId)) delete current.conversations[taskId];
      }
    });
  }

  function applySnapshot(snapshot: AgentTasksSnapshot): void {
    listRequests.set(snapshot.agentId, (listRequests.get(snapshot.agentId) ?? 0) + 1);
    setSnapshot(snapshot);
  }

  /** Keeps the newest conversation of a task. A delta raises the revision, so an older snapshot loses. */
  function applyConversation(taskId: string, snapshot: ConversationSnapshot): void {
    const stored = state.conversations[taskId];
    if (stored && snapshot.revision < stored.revision) return;
    setState((current) => {
      current.conversations[taskId] = snapshot;
    });
  }

  function applyDelta(event: Extract<AgentTaskEvent, { type: "agent-task-conversation-delta" }>): void {
    const stored = state.conversations[event.taskId];
    // A task that did not load its conversation reads it whole when it opens.
    if (!stored || event.revision <= stored.revision) return;
    setState((current) => {
      const conversation = current.conversations[event.taskId];
      if (!conversation) return;
      conversation.revision = event.revision;
      const existing = conversation.messages.find((message) => message.id === event.messageId);
      if (existing) {
        existing.text += event.delta;
        existing.status = "streaming";
        return;
      }
      conversation.messages.push({
        id: event.messageId,
        turnId: event.turnId,
        author: "assistant",
        text: event.delta,
        createdAt: event.createdAt,
        status: "streaming",
      });
    });
  }

  /**
   * A list from an event of a joined server has no branch links. When it has a task that the stored list
   * does not have, the list is read again: the new task can be a branch from another device.
   */
  function applyTasksChanged(snapshot: AgentTasksSnapshot): void {
    const known = untrack(() => {
      const stored = state.snapshots[snapshot.agentId];
      return stored && branchable() ? new Set(stored.tasks.map((task) => task.id)) : undefined;
    });
    applySnapshot(snapshot);
    if (known && snapshot.tasks.some((task) => task.branch === undefined && !known.has(task.id)))
      void loadTasks(snapshot.agentId);
  }

  function applyEvent(event: AgentTaskEvent): void {
    if (event.type === "agent-tasks-changed") applyTasksChanged(event.snapshot);
    else if (event.type === "agent-task-conversation") applyConversation(event.taskId, event.snapshot);
    else applyDelta(event);
  }

  /** Reads an agent's thread list. Resolves true when this read is the newest list. */
  function loadTasks(agentId: string): Promise<boolean> {
    const request = (listRequests.get(agentId) ?? 0) + 1;
    listRequests.set(agentId, request);
    return port()
      .listTasks(agentId)
      .then((snapshot) => {
        if (!scopeIsCurrent() || listRequests.get(agentId) !== request) return false;
        setSnapshot(snapshot);
        return true;
      })
      .catch((error) => {
        if (!scopeIsCurrent() || listRequests.get(agentId) !== request || agentId !== activeAgentId()) return false;
        const { t, errorMessage } = currentText();
        actionToast.error(errorMessage(error, t("conversation.threads.error.load")));
        return false;
      });
  }

  createEffect(
    () => ({
      agentId: activeAgentId(),
      reload: options.reloadKey(),
      shown: available(),
      // A running thread can end while the server is away, and the sidebar shows its agent as working.
      running: untrack(() =>
        Object.values(state.snapshots).flatMap((snapshot) =>
          snapshot.tasks.some((task) => task.state === "running") ? [snapshot.agentId] : [],
        ),
      ),
    }),
    ({ agentId, shown, running }) => {
      if (!shown) return;
      for (const id of new Set([...(agentId ? [agentId] : []), ...running])) void loadTasks(id);
    },
  );

  /** Reads the whole conversation of a thread, when its tab opens. */
  function openTask(agentId: string, taskId: string): void {
    const request = (readRequests.get(taskId) ?? 0) + 1;
    readRequests.set(taskId, request);
    void port()
      .readTask({ agentId, taskId })
      .then((snapshot) => {
        if (!scopeIsCurrent() || readRequests.get(taskId) !== request) return;
        applyConversation(taskId, snapshot);
      })
      .catch((error) => {
        if (!scopeIsCurrent() || readRequests.get(taskId) !== request) return;
        const { t, errorMessage } = currentText();
        actionToast.error(errorMessage(error, t("conversation.threads.error.read")));
      });
  }

  /** Adds a task that an action returned, so its tab shows before the list event arrives. */
  function rememberTask(task: AgentTask): void {
    setState((current) => {
      const snapshot = current.snapshots[task.agentId];
      if (!snapshot) return;
      const stored = snapshot.tasks.find((entry) => entry.id === task.id);
      // The event of a joined server can arrive first, without the link of a branch.
      if (stored) {
        if (!stored.branch && task.branch) stored.branch = task.branch;
        return;
      }
      snapshot.tasks.unshift(task);
    });
  }

  async function runAction<Result>(action: () => Promise<Result>, fallback: AppTextKey): Promise<Result | null> {
    try {
      return await action();
    } catch (error) {
      if (!scopeIsCurrent()) return null;
      const { t, errorMessage } = currentText();
      actionToast.error(errorMessage(error, t(fallback)));
      return null;
    }
  }

  /** Sends `attachmentDraftIds` only when there are files, so a server with text-only threads gets no new key. */
  async function startTask(
    agentId: string,
    text: string,
    attachmentDraftIds: string[] = [],
  ): Promise<AgentTask | null> {
    const task = await runAction(
      () =>
        port().startTask({
          agentId,
          text,
          ...(attachmentDraftIds.length ? { attachmentDraftIds } : {}),
          clientMessageId: crypto.randomUUID(),
        }),
      "conversation.threads.error.start",
    );
    if (task && scopeIsCurrent()) rememberTask(task);
    return task;
  }

  async function runQueuedMessageAsTask(agentId: string, deliveryId: string): Promise<AgentTask | null> {
    const run = port().runQueuedMessageAsTask;
    if (!run) return null;
    const task = await runAction(() => run({ agentId, deliveryId }), "conversation.threads.error.start");
    if (task && scopeIsCurrent()) rememberTask(task);
    return task;
  }

  /** Whether the server copies a conversation into a new thread. */
  const canBranch = (): boolean => branchable() && port().branchTask !== undefined;

  /**
   * Copies a conversation through an agent answer into a new thread: the agent's own chat when
   * `sourceTaskId` is null, or a side thread. A retry of one click would send the same request id.
   */
  async function branchTask(
    agentId: string,
    sourceTaskId: string | null,
    messageId: string,
  ): Promise<AgentTask | null> {
    const branch = port().branchTask;
    if (!branch || !branchable()) return null;
    const analytics = desktopAnalytics.scope();
    const task = await runAction(
      () => branch({ agentId, taskId: sourceTaskId, messageId, requestId: crypto.randomUUID() }),
      "conversation.threads.error.branch",
    );
    analytics.track("agent_action", { action: "branch", result: task ? "succeeded" : "failed" });
    if (task && scopeIsCurrent()) rememberTask(task);
    return task;
  }

  /** Steers the task's running turn, or queues the message in the task. */
  async function sendToTask(
    agentId: string,
    taskId: string,
    text: string,
    attachmentDraftIds: string[] = [],
  ): Promise<boolean> {
    const receipt = await runAction(
      () =>
        port().sendToTask({
          agentId,
          taskId,
          text,
          ...(attachmentDraftIds.length ? { attachmentDraftIds } : {}),
          clientMessageId: crypto.randomUUID(),
        }),
      "conversation.threads.error.send",
    );
    return receipt !== null;
  }

  function stopTask(agentId: string, taskId: string): void {
    void runAction(() => port().stopTask({ agentId, taskId }), "conversation.threads.error.stop");
  }

  /**
   * Archives a thread. Its queued messages stop; a running turn must stop first. A `serverId` sends
   * the request to that server, also after a server switch.
   */
  async function closeTask(agentId: string, taskId: string, serverId?: string): Promise<boolean> {
    const done = await runAction(
      () => port().closeTask({ agentId, taskId }, serverId),
      "conversation.threads.error.archive",
    );
    return done !== null;
  }

  async function reopenTask(agentId: string, taskId: string, serverId?: string): Promise<boolean> {
    const done = await runAction(
      () => port().reopenTask({ agentId, taskId }, serverId),
      "conversation.threads.error.restore",
    );
    return done !== null;
  }

  async function renameTask(agentId: string, taskId: string, title: string): Promise<boolean> {
    const done = await runAction(
      () => port().renameTask({ agentId, taskId, title }),
      "conversation.threads.error.rename",
    );
    return done !== null;
  }

  async function deleteTask(agentId: string, taskId: string, serverId?: string): Promise<boolean> {
    const done = await runAction(
      () => port().deleteTask({ agentId, taskId }, serverId),
      "conversation.threads.error.delete",
    );
    if (done === null || !scopeIsCurrent()) return false;
    setState((current) => {
      delete current.conversations[taskId];
    });
    return true;
  }

  /**
   * Moves the person's read mark of a side thread to the message that they see. The member's other
   * devices read the mark, so the phone no longer shows the thread as unread. A failure keeps the
   * old mark: the next message moves it.
   */
  function markTaskRead(agentId: string, taskId: string, throughMessageId: string): void {
    if (!readable() || readMarks.get(taskId) === throughMessageId) return;
    readMarks.set(taskId, throughMessageId);
    void port()
      .markTaskRead({ agentId, taskId, throughMessageId })
      .catch(() => {
        if (readMarks.get(taskId) === throughMessageId) readMarks.delete(taskId);
      });
  }

  /**
   * Reads the active agent's list and each loaded conversation again, after the server was away. The
   * lists come first: a thread that another device deleted meanwhile is not read again.
   */
  function reload(): void {
    if (!available()) return;
    const agentIds = new Set(Object.values(state.conversations).map((conversation) => conversation.agentId));
    const active = activeAgentId();
    if (active) agentIds.add(active);
    for (const agentId of agentIds) {
      void loadTasks(agentId).then((loaded) => {
        if (!loaded) return;
        for (const [taskId, conversation] of Object.entries(state.conversations)) {
          if (conversation.agentId === agentId) openTask(agentId, taskId);
        }
      });
    }
  }

  return {
    available,
    editable,
    local,
    snapshot: (agentId: string): AgentTasksSnapshot | undefined => state.snapshots[agentId],
    conversation: (taskId: string): ConversationSnapshot | undefined => state.conversations[taskId],
    applyEvent,
    reload,
    loadTasks,
    openTask,
    startTask,
    runQueuedMessageAsTask,
    canBranch,
    branchTask,
    sendToTask,
    stopTask,
    closeTask,
    reopenTask,
    renameTask,
    deleteTask,
    markTaskRead,
  };
}

export type AgentTasks = ReturnType<typeof createAgentTasks>;
