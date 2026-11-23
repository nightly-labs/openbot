import type {
  AgentEvent,
  AgentTask,
  AgentTasksSnapshot,
  ConversationMessage,
  ConversationSnapshot,
  TeamRealtimeEvent,
} from "@openbot/contracts/ipc";
import type { QueryClient } from "@tanstack/react-query";
import { type QueryScope, queryKeys } from "./query-keys";

type TaskDelta = Extract<AgentEvent, { type: "agent-task-conversation-delta" }>;

function withTaskDelta(conversation: ConversationSnapshot, delta: TaskDelta): ConversationSnapshot {
  if (delta.revision <= conversation.revision) return conversation;
  const index = conversation.messages.findIndex((message) => message.id === delta.messageId);
  const messages =
    index < 0
      ? [
          ...conversation.messages,
          {
            id: delta.messageId,
            turnId: delta.turnId,
            author: "assistant" as const,
            text: delta.delta,
            createdAt: delta.createdAt,
            status: "streaming" as const,
          },
        ]
      : conversation.messages.map((message, at) =>
          at === index ? { ...message, text: message.text + delta.delta, status: "streaming" as const } : message,
        );
  return { ...conversation, revision: delta.revision, messages };
}

interface PendingTaskDeltas {
  queryClient: QueryClient;
  queryKey: ReturnType<typeof queryKeys.agentTaskConversation>;
  deltas: TaskDelta[];
}

const pendingTaskDeltas = new Map<string, PendingTaskDeltas>();
let taskDeltaFlushWaits = false;

function flushTaskDeltas(): void {
  taskDeltaFlushWaits = false;
  const pending = [...pendingTaskDeltas.values()];
  pendingTaskDeltas.clear();
  for (const { queryClient, queryKey, deltas } of pending) {
    queryClient.setQueryData<ConversationSnapshot>(
      queryKey,
      (stored) => stored && deltas.reduce(withTaskDelta, stored),
    );
  }
}

function queueTaskDelta(queryClient: QueryClient, scope: QueryScope, serverId: string, delta: TaskDelta): void {
  const queryKey = queryKeys.agentTaskConversation(scope, serverId, delta.taskId);
  const id = JSON.stringify(queryKey);
  const pending = pendingTaskDeltas.get(id);
  if (pending && pending.queryClient === queryClient) pending.deltas.push(delta);
  else {
    if (pending) flushTaskDeltas();
    pendingTaskDeltas.set(id, { queryClient, queryKey, deltas: [delta] });
  }
  if (taskDeltaFlushWaits) return;
  taskDeltaFlushWaits = true;
  requestAnimationFrame(flushTaskDeltas);
}

function withStoredBranches(snapshot: AgentTasksSnapshot, stored: AgentTasksSnapshot | undefined): AgentTasksSnapshot {
  if (!stored?.tasks.some((task) => task.branch)) return snapshot;
  const links = new Map(stored.tasks.flatMap((task) => (task.branch ? [[task.id, task.branch] as const] : [])));
  return {
    ...snapshot,
    tasks: snapshot.tasks.map((task) => {
      const branch = task.branch === undefined ? links.get(task.id) : undefined;
      return branch ? { ...task, branch } : task;
    }),
  };
}

function unreadKey(snapshot: AgentTasksSnapshot): string {
  return snapshot.tasks.map((task) => `${task.id}:${task.state}:${task.outcome}:${task.updatedAt}`).join("|");
}

export function applyTaskEvent(
  queryClient: QueryClient,
  scope: QueryScope,
  serverId: string,
  event: AgentEvent | TeamRealtimeEvent,
): void {
  if (event.type === "agent-tasks-changed") {
    const key = queryKeys.agentTasks(scope, serverId, event.snapshot.agentId);
    const stored = queryClient.getQueryData<AgentTasksSnapshot>(key);
    queryClient.setQueryData(key, withStoredBranches(event.snapshot, stored));
    if (stored && event.snapshot.tasks.some((task) => !stored.tasks.some((entry) => entry.id === task.id)))
      void queryClient.invalidateQueries({ queryKey: key, exact: true });
    if (!stored || unreadKey(stored) !== unreadKey(event.snapshot))
      void queryClient.invalidateQueries({
        queryKey: queryKeys.agentThreadReads(scope, serverId, event.snapshot.agentId),
      });
  } else if (event.type === "agent-task-conversation") {
    if (pendingTaskDeltas.size) flushTaskDeltas();
    queryClient.setQueryData<ConversationSnapshot>(
      queryKeys.agentTaskConversation(scope, serverId, event.taskId),
      (stored) => (stored && event.snapshot.revision < stored.revision ? stored : event.snapshot),
    );
  } else if (event.type === "agent-task-conversation-delta") {
    queueTaskDelta(queryClient, scope, serverId, event);
  }
}

export function addStartedTask(queryClient: QueryClient, scope: QueryScope, serverId: string, task: AgentTask): void {
  queryClient.setQueryData<AgentTasksSnapshot>(queryKeys.agentTasks(scope, serverId, task.agentId), (stored) =>
    stored && !stored.tasks.some((entry) => entry.id === task.id)
      ? { ...stored, tasks: [task, ...stored.tasks] }
      : stored,
  );
}

export function taskThreadCheck(
  queryClient: QueryClient,
  scope: QueryScope,
  serverId: string,
): (agentId: string, threadId: string) => boolean {
  return (agentId, threadId) =>
    queryClient
      .getQueryData<AgentTasksSnapshot>(queryKeys.agentTasks(scope, serverId, agentId))
      ?.tasks.some((task) => task.threadId === threadId) ?? false;
}

export function taskTurnThread(
  queryClient: QueryClient,
  scope: QueryScope,
  serverId: string,
  agentId: string,
  turnId: string,
): string | null {
  return (
    queryClient
      .getQueryData<AgentTasksSnapshot>(queryKeys.agentTasks(scope, serverId, agentId))
      ?.tasks.find((task) => task.activeTurnId === turnId)?.threadId ?? null
  );
}

export function withoutTaskTurns(
  queryClient: QueryClient,
  scope: QueryScope,
  serverId: string,
  event: AgentEvent | TeamRealtimeEvent,
): AgentEvent | TeamRealtimeEvent | null {
  const tasksOf = (agentId: string) =>
    queryClient.getQueryData<AgentTasksSnapshot>(queryKeys.agentTasks(scope, serverId, agentId))?.tasks ?? [];
  const isTaskThread = taskThreadCheck(queryClient, scope, serverId);
  const taskThread = (request: { agentId: string; threadId: string }) =>
    isTaskThread(request.agentId, request.threadId);
  switch (event.type) {
    case "turn-started":
    case "turn-progress":
    case "prompt":
      return taskThread(event) ? null : event;
    case "approval":
      return taskThread(event.approval) ? null : event;
    case "browser-takeover-requested":
      return taskThread(event.request) ? null : event;
    case "runtime-snapshot": {
      const { snapshot } = event;
      const taskTurn = (work: { agentId: string; turnId: string | null }) =>
        work.turnId !== null && tasksOf(work.agentId).some((task) => task.activeTurnId === work.turnId);
      return {
        ...event,
        snapshot: {
          ...snapshot,
          activeTurns: snapshot.activeTurns.filter((turn) => !taskThread(turn)),
          work: snapshot.work.filter((work) => !taskTurn(work)),
          pendingPrompts: snapshot.pendingPrompts.filter((request) => !taskThread(request)),
          pendingApprovals: snapshot.pendingApprovals.filter((request) => !taskThread(request)),
          pendingBrowserTakeovers: snapshot.pendingBrowserTakeovers.filter((request) => !taskThread(request)),
        },
      };
    }
    default:
      return event;
  }
}

export function taskThreadMessages(
  queryClient: QueryClient,
  scope: QueryScope,
  serverId: string,
  agentId: string,
  threadId: string,
): readonly ConversationMessage[] | undefined {
  const task = queryClient
    .getQueryData<AgentTasksSnapshot>(queryKeys.agentTasks(scope, serverId, agentId))
    ?.tasks.find((entry) => entry.threadId === threadId);
  if (!task) return undefined;
  return (
    queryClient.getQueryData<ConversationSnapshot>(queryKeys.agentTaskConversation(scope, serverId, task.id))
      ?.messages ?? []
  );
}
