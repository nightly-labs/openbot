import type { AgentEvent, AgentTasksSnapshot, ConversationSnapshot, TeamRealtimeEvent } from "@openbot/contracts/ipc";
import type { QueryClient } from "@tanstack/react-query";
import { type QueryScope, queryKeys } from "./query-keys";

type TaskDelta = Extract<AgentEvent, { type: "agent-task-conversation-delta" }>;

/** The conversation with the streamed text of one delta. An older delta changes nothing. */
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

/**
 * Writes one task event of `agent-tasks-v1` into the cached reads, as the desktop Tasks page does: the
 * whole task list of one agent, the whole conversation of one task, or streamed text of it.
 */
export function applyTaskEvent(
  queryClient: QueryClient,
  scope: QueryScope,
  serverId: string,
  event: AgentEvent | TeamRealtimeEvent,
): void {
  if (event.type === "agent-tasks-changed") {
    queryClient.setQueryData(queryKeys.agentTasks(scope, serverId, event.snapshot.agentId), event.snapshot);
    // A new answer in a thread, or a thread that starts or goes, changes what is unread. The host
    // sends no event when a read mark moves, so the marks load again with the list.
    void queryClient.invalidateQueries({
      queryKey: queryKeys.agentThreadReads(scope, serverId, event.snapshot.agentId),
    });
  } else if (event.type === "agent-task-conversation") {
    // A delta raises the revision, so an older snapshot loses.
    queryClient.setQueryData<ConversationSnapshot>(
      queryKeys.agentTaskConversation(scope, serverId, event.taskId),
      (stored) => (stored && event.snapshot.revision < stored.revision ? stored : event.snapshot),
    );
  } else if (event.type === "agent-task-conversation-delta") {
    // A task that did not load its conversation reads it whole when it opens.
    queryClient.setQueryData<ConversationSnapshot>(
      queryKeys.agentTaskConversation(scope, serverId, event.taskId),
      (stored) => stored && withTaskDelta(stored, event),
    );
  }
}

/**
 * The event as the agent's own chat sees it. A task turn runs on the task's own thread, and the host
 * sends its turn, question, approval and takeover events with that thread, so the chat would show
 * the task's work, or a question it cannot show, as its own. A task that the phone has not read is
 * not known here; its next list event removes its turn from the chat (see `reduceAgentActivity`).
 * `turn-completed` always passes, so an activity that a task turn set before its list arrived ends.
 */
export function withoutTaskTurns(
  queryClient: QueryClient,
  scope: QueryScope,
  serverId: string,
  event: AgentEvent | TeamRealtimeEvent,
): AgentEvent | TeamRealtimeEvent | null {
  const tasksOf = (agentId: string) =>
    queryClient.getQueryData<AgentTasksSnapshot>(queryKeys.agentTasks(scope, serverId, agentId))?.tasks ?? [];
  const taskThread = (request: { agentId: string; threadId: string }) =>
    tasksOf(request.agentId).some((task) => task.threadId === request.threadId);
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
