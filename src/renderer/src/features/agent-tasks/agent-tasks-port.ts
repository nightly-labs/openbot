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
  /** The older messages of a thread, page by page. Missing where the server cannot read them. */
  readTaskPage?: OpenBotDesktopApi["agent"]["readTaskPage"];
  /** The messages of a thread around one message, so a jump to it reads one part. Missing where the server cannot read it. */
  readTaskAround?: OpenBotDesktopApi["agent"]["readTaskAround"];
  /** Missing where the server cannot branch a conversation. The branch actions then do not show. */
  branchTask?: OpenBotDesktopApi["agent"]["branchTask"];
  /** Deletes one message of a thread. Missing where the server cannot delete messages. */
  deleteTaskMessage?: ((input: { agentId: string; taskId: string; messageId: string }) => Promise<void>) | undefined;
  /**
   * The actions of a thread's queue. Missing where the server sends no queue of a thread: only this
   * computer does, `agent-tasks-v1` sends the start of each message alone.
   */
  queue?: Pick<OpenBotDesktopApi["agent"], "cancelQueuedMessage" | "steerQueuedMessage" | "reorderQueue"> | undefined;
}

/**
 * The side threads on desktop, on one server. The thread state lives as long as its server scope, so
 * each call names that server: a message that waits for its files, or a reply that comes after a
 * server switch, stays on the server of the thread (#9123). A delete that waits for its Undo time
 * names its own server.
 * Read on each call: tests and stories replace `window.openbot` per case.
 */
export function agentTasksPort(server: string): AgentTasksPort {
  const { agent } = window.openbot;
  return {
    listTasks: (agentId) => agent.listTasks(agentId, server),
    readTask: (input) => agent.readTask(input, server),
    readTaskPage: (input) => agent.readTaskPage(input, server),
    readTaskAround: (input) => agent.readTaskAround(input, server),
    startTask: (input) => agent.startTask(input, server),
    sendToTask: (input) => agent.sendMessage(input, server),
    runQueuedMessageAsTask: (input) => agent.runQueuedMessageAsTask(input, server),
    branchTask: (input) => agent.branchTask(input, server),
    stopTask: (input) => agent.stopTask(input, server),
    closeTask: (input, serverId) => agent.closeTask(input, serverId ?? server),
    reopenTask: (input, serverId) => agent.reopenTask(input, serverId ?? server),
    renameTask: (input) => agent.renameTask(input, server),
    deleteTask: (input, serverId) => agent.deleteTask(input, serverId ?? server),
    deleteTaskMessage: (input) => agent.deleteConversationMessage(input, server),
    listTaskReads: (agentId) => agent.listTaskReads(agentId, server),
    markTaskRead: (input) => agent.markTaskRead(input, server),
    queue: {
      cancelQueuedMessage: (input) => agent.cancelQueuedMessage(input, server),
      steerQueuedMessage: (input) => agent.steerQueuedMessage(input, server),
      reorderQueue: (input) => agent.reorderQueue(input, server),
    },
  };
}
