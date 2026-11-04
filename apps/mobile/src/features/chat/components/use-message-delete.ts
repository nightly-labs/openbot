import { canAdministerServer } from "@openbot/contracts/ipc";
import { useCallback } from "react";
import { useAgentAccessLevel } from "@/features/servers/model/use-server-roles";
import {
  useMobileWorkspaceActions,
  useMobileWorkspaceSelector,
} from "@/features/workspace/context/mobile-workspace-context";
import { showsOnline } from "@/features/workspace/model/server-status";

/** The chat whose messages the reader deletes: an agent chat, one task of the agent, or a channel. */
export type MessageDeleteChat =
  | { kind: "agent"; agentId: string; taskId?: string }
  | { kind: "channel"; channelId: string };

/**
 * Delete in the message sheet, as on desktop (`message-delete-v1`). Every member deletes the messages
 * that they sent. An owner or admin deletes any message; in an agent chat, `manage` on the agent
 * does too. The host checks it again. `deleteMessage` is unset on an offline host, on a host without
 * the capability, and for a member who can only view the agent. After a delete, the host sends its
 * change events, so the chat reads its messages again.
 */
export function useMessageDelete(serverId: string, chat: MessageDeleteChat) {
  const { deleteMessage: remove } = useMobileWorkspaceActions();
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
    (messageId: string) =>
      remove(
        serverId,
        kind === "channel"
          ? { kind, channelId: chatId, messageId }
          : { kind, agentId: chatId, ...(taskId ? { taskId } : {}), messageId },
      ),
    [remove, serverId, kind, chatId, taskId],
  );
  return { deleteMessage: supported && !viewOnly ? deleteMessage : undefined, deletesAny };
}
