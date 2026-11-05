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
  /**
   * The person's read mark of each open thread of an agent. Missing where the client does not read the
   * marks: no thread then shows as unread.
   */
  listTaskReads?: OpenBotDesktopApi["agent"]["listTaskReads"];
  /** Steers the thread's running turn, or queues the message in the thread. */
  sendToTask(
    input: AgentTaskInput & {
      text: string;
      attachmentDraftIds?: string[];
      replyToMessageId?: string;
      clientMessageId: string;
    },
  ): Promise<unknown>;
  /** Missing where the server cannot move a queued message of the agent's own chat to a new thread. */
  runQueuedMessageAsTask?: OpenBotDesktopApi["agent"]["runQueuedMessageAsTask"];
  /** Missing where the server cannot branch a conversation. The branch actions then do not show. */
  branchTask?: OpenBotDesktopApi["agent"]["branchTask"];
  /** Deletes one message of a thread. Missing where the server cannot delete messages. */
  deleteTaskMessage?: ((input: { agentId: string; taskId: string; messageId: string }) => Promise<void>) | undefined;
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
    branchTask: (input) => agent.branchTask(input),
    stopTask: (input) => agent.stopTask(input),
    closeTask: (input, serverId) => agent.closeTask(input, serverId),
    reopenTask: (input, serverId) => agent.reopenTask(input, serverId),
    renameTask: (input) => agent.renameTask(input),
    deleteTask: (input, serverId) => agent.deleteTask(input, serverId),
    deleteTaskMessage: (input) => agent.deleteConversationMessage(input),
    listTaskReads: (agentId) => agent.listTaskReads(agentId),
    markTaskRead: (input) => agent.markTaskRead(input),
  };
}
