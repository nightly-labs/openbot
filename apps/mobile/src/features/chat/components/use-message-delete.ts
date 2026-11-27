import { canAdministerServer } from "@openbot/contracts/ipc";
import { useCallback } from "react";
import { useAgentAccessLevel } from "@/features/servers/model/use-server-roles";
import {
  useMobileWorkspaceActions,
  useMobileWorkspaceSelector,
} from "@/features/workspace/context/mobile-workspace-context";
import { showsOnline } from "@/features/workspace/model/server-status";

export type MessageDeleteChat =
  | { kind: "agent"; agentId: string; taskId?: string }
  | { kind: "channel"; channelId: string };

export function useMessageDelete(serverId: string, chat: MessageDeleteChat) {
  const { deleteMessage: remove, channelStore } = useMobileWorkspaceActions();
  const conversationStore = useMobileWorkspaceSelector((workspace) => workspace.conversationStore);
  const supported = useMobileWorkspaceSelector((workspace) => {
    const server = workspace.servers.find((item) => item.id === serverId);
    return showsOnline(server) && workspace.canDeleteMessages(serverId);
  });
  const role = useMobileWorkspaceSelector(
    (workspace) => workspace.servers.find((server) => server.id === serverId)?.role,
  );
  const level = useAgentAccessLevel(serverId, chat.kind === "agent" ? chat.agentId : "");
  const deletesAny = chat.kind === "channel" ? canAdministerServer(role) : level === "manage";
  const viewOnly = chat.kind === "agent" && level === "view";
  const kind = chat.kind;
  const chatId = chat.kind === "agent" ? chat.agentId : chat.channelId;
  const taskId = chat.kind === "agent" ? chat.taskId : undefined;
  const deleteMessage = useCallback(
    async (messageId: string) => {
      if (kind === "channel") {
        await remove(serverId, { kind, channelId: chatId, messageId });
        channelStore.removeMessage(serverId, chatId, messageId);
      } else if (taskId) {
        await remove(serverId, { kind, agentId: chatId, taskId, messageId });
      } else {
        await remove(serverId, { kind, agentId: chatId, messageId });
        conversationStore.removeMessage(chatId, messageId);
      }
    },
    [remove, channelStore, conversationStore, serverId, kind, chatId, taskId],
  );
  return { deleteMessage: supported && !viewOnly ? deleteMessage : undefined, deletesAny };
}
