import type { AgentTaskInput, OpenBotDesktopApi } from "@openbot/contracts/ipc";
import { noteAgentRequest } from "../../agent-requests";

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
  listTaskReads?: OpenBotDesktopApi["agent"]["listTaskReads"];
  sendToTask(
    input: AgentTaskInput & {
      text: string;
      attachmentDraftIds?: string[];
      replyToMessageId?: string;
      clientMessageId: string;
    },
  ): Promise<unknown>;
  runQueuedMessageAsTask?: OpenBotDesktopApi["agent"]["runQueuedMessageAsTask"];
  readTaskPage?: OpenBotDesktopApi["agent"]["readTaskPage"];
  readTaskAround?: OpenBotDesktopApi["agent"]["readTaskAround"];
  branchTask?: OpenBotDesktopApi["agent"]["branchTask"];
  deleteTaskMessage?: ((input: { agentId: string; taskId: string; messageId: string }) => Promise<void>) | undefined;
  queue?: Pick<OpenBotDesktopApi["agent"], "cancelQueuedMessage" | "steerQueuedMessage" | "reorderQueue"> | undefined;
}

export function agentTasksPort(server: string): AgentTasksPort {
  const { agent } = window.openbot;
  return {
    listTasks: (agentId) => agent.listTasks(agentId, server),
    readTask: (input) => agent.readTask(input, server),
    readTaskPage: (input) => agent.readTaskPage(input, server),
    readTaskAround: (input) => agent.readTaskAround(input, server),
    startTask: (input) => {
      noteAgentRequest(server, input.agentId);
      return agent.startTask(input, server);
    },
    sendToTask: (input) => {
      noteAgentRequest(server, input.agentId);
      return agent.sendMessage(input, server);
    },
    runQueuedMessageAsTask: (input) => {
      noteAgentRequest(server, input.agentId);
      return agent.runQueuedMessageAsTask(input, server);
    },
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
