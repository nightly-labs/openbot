import type {
  AgentEvent,
  AgentTask,
  AgentTaskInput,
  AgentTasksSnapshot,
  ConversationSnapshot,
  StartAgentTaskInput,
} from "@openbot/contracts/ipc";

export type TaskEvent = Extract<
  AgentEvent,
  { type: "agent-tasks-changed" | "agent-task-conversation" | "agent-task-conversation-delta" }
>;

/** A task event of a host. Other events do not change a task. */
export function isTaskEvent(event: { type: string }): event is TaskEvent {
  return (
    event.type === "agent-tasks-changed" ||
    event.type === "agent-task-conversation" ||
    event.type === "agent-task-conversation-delta"
  );
}

/** What the Tasks page reads and changes on a server: the task lists, the task conversations and the task actions. */
export interface TasksSource {
  list(agentId: string, serverId: string): Promise<AgentTasksSnapshot>;
  read(input: AgentTaskInput, serverId: string): Promise<ConversationSnapshot>;
  start(input: StartAgentTaskInput, serverId: string): Promise<AgentTask>;
  /** Steers the task's running turn, or queues the message in the task. */
  send(input: AgentTaskInput & { text: string; clientMessageId: string }, serverId: string): Promise<unknown>;
  stop(input: AgentTaskInput, serverId: string): Promise<void>;
  close(input: AgentTaskInput, serverId: string): Promise<void>;
  reopen(input: AgentTaskInput, serverId: string): Promise<void>;
  /** Calls `apply` for each task event of the server, and `reload` when the server is back after a disconnect. Returns the unsubscribe. */
  onEvent(serverId: string, apply: (event: TaskEvent) => void, reload: () => void): () => void;
}

/** The tasks on desktop: main reaches the tasks of any server. Read on each call: tests and stories replace `window.openbot` per case. */
export function desktopTasksSource(): TasksSource {
  return {
    list: (agentId, serverId) => window.openbot.agent.listTasks(agentId, serverId),
    read: (input, serverId) => window.openbot.agent.readTask(input, serverId),
    start: (input, serverId) => window.openbot.agent.startTask(input, serverId),
    send: (input, serverId) => window.openbot.agent.sendMessage(input, serverId),
    stop: (input, serverId) => window.openbot.agent.stopTask(input, serverId),
    close: (input, serverId) => window.openbot.agent.closeTask(input, serverId),
    reopen: (input, serverId) => window.openbot.agent.reopenTask(input, serverId),
    onEvent(serverId, apply, reload) {
      const unsubscribe = window.openbot.agent.onScopedEvent((scoped) => {
        if (scoped.serverId === serverId && isTaskEvent(scoped.event)) apply(scoped.event);
      });
      let online = true;
      const reconnect = window.openbot.servers.onEvent((servers) => {
        const now = servers.some((server) => server.id === serverId && server.state === "online");
        if (now && !online) reload();
        online = now;
      });
      return () => {
        unsubscribe();
        reconnect();
      };
    },
  };
}
