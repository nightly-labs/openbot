import type { AgentTaskInput, OpenBotDesktopApi } from "@openbot/contracts/ipc";

/** What the side thread state reaches on a server: the list, a thread's conversation, and the thread actions. */
export interface AgentTasksPort
  extends Pick<
    OpenBotDesktopApi["agent"],
    | "closeTask"
    | "deleteTask"
    | "listTasks"
    | "markTaskRead"
    | "readTask"
    | "renameTask"
    | "reopenTask"
    | "startTask"
    | "stopTask"
  > {
  /** Steers the thread's running turn, or queues the message in the thread. */
  sendToTask(
    input: AgentTaskInput & { text: string; attachmentDraftIds?: string[]; clientMessageId: string },
  ): Promise<unknown>;
  /** Missing where the server cannot move a queued message of the agent's own chat to a new thread. */
  runQueuedMessageAsTask?: OpenBotDesktopApi["agent"]["runQueuedMessageAsTask"];
}

/**
 * The side threads on desktop: main reaches the active server, or the server that a call names. A
 * delete that waits for its Undo time names its server, so a server switch does not move it.
 * Read on each call: tests and stories replace `window.openbot` per case.
 */
export function agentTasksPort(): AgentTasksPort {
  const { agent } = window.openbot;
  return {
    listTasks: (agentId) => agent.listTasks(agentId),
    readTask: (input) => agent.readTask(input),
    startTask: (input) => agent.startTask(input),
    sendToTask: (input) => agent.sendMessage(input),
    runQueuedMessageAsTask: (input) => agent.runQueuedMessageAsTask(input),
    stopTask: (input) => agent.stopTask(input),
    closeTask: (input, serverId) => agent.closeTask(input, serverId),
    reopenTask: (input, serverId) => agent.reopenTask(input, serverId),
    renameTask: (input) => agent.renameTask(input),
    deleteTask: (input, serverId) => agent.deleteTask(input, serverId),
    markTaskRead: (input) => agent.markTaskRead(input),
  };
}
