import type { AgentAccessLevel, AgentAccessLevels, AgentAccessSnapshot, ServerSummary } from "@openbot/contracts/ipc";
import { AGENT_ACCESS_CAPABILITY } from "@openbot/contracts/team-protocol/agent-access-v1";
import { MESSAGE_DELETE_CAPABILITY } from "@openbot/contracts/team-protocol/message-delete-v1";
import type { AgentMessage } from "@openbot/ui/data";
import { createEffect, createSignal } from "solid-js";
import { serverRoleCanAdminister, serverSupportsCapability } from "../servers/server-capabilities";
import { conversationPort } from "./conversation-port";
import { PENDING_SEND_ID_PREFIX } from "./stores/pending-send-store";

export function readerCanDeleteMessage(
  message: AgentMessage,
  access: { deleteAny: boolean; isOwnSender: (senderId: string) => boolean },
): boolean {
  if (message.streaming || message.id.startsWith(PENDING_SEND_ID_PREFIX) || message.id.startsWith("ui-")) return false;
  if (access.deleteAny) return true;
  const sender = message.author === "you" ? message.senderMember : undefined;
  return sender !== undefined && access.isOwnSender(sender.id);
}

export interface AgentLevelsSource {
  levelsServerId: () => string | null;
  readLevels: (serverId: string) => Promise<AgentAccessSnapshot>;
  onLevelsChanged: (serverId: string, listener: () => void) => () => void;
}

export interface AgentMessageDeleteAccessSource extends AgentLevelsSource {
  deletesAny: () => boolean;
}

export function createAgentLevels(source: AgentLevelsSource) {
  const [levels, setLevels] = createSignal<{ serverId: string; mine: AgentAccessLevels } | null>(null);
  createEffect(
    () => source.levelsServerId(),
    (serverId) => {
      setLevels(null);
      if (serverId === null) return;
      let active = true;
      const read = () => {
        source.readLevels(serverId).then(
          (access) => {
            if (active) setLevels({ serverId, mine: access.mine });
          },
          () => undefined,
        );
      };
      read();
      const stop = source.onLevelsChanged(serverId, read);
      return () => {
        active = false;
        stop();
      };
    },
  );
  return (agentId: string): AgentAccessLevel | undefined => {
    const known = levels();
    return known !== null && known.serverId === source.levelsServerId() ? known.mine[agentId] : undefined;
  };
}

export function createAgentMessageDeleteAccess(source: AgentMessageDeleteAccessSource) {
  const level = createAgentLevels(source);
  return (agentId: string | undefined): boolean =>
    source.deletesAny() || (agentId !== undefined && level(agentId) === "manage");
}

export const desktopAgentLevels: Pick<AgentLevelsSource, "readLevels" | "onLevelsChanged"> = {
  readLevels: (serverId) => conversationPort().hostAdmin.getAgentAccess(serverId),
  onLevelsChanged: (serverId, listener) =>
    conversationPort().agent.onScopedEvent((scoped) => {
      if (scoped.serverId === serverId && scoped.event.type === "agent-access-changed") listener();
    }),
};

export function desktopAgentMessageDeleteAccess(
  server: () => ServerSummary | undefined,
): AgentMessageDeleteAccessSource {
  return {
    deletesAny: () => {
      const current = server();
      return current?.kind !== "remote" || serverRoleCanAdminister(current);
    },
    levelsServerId: () => {
      const current = server();
      return current?.kind === "remote" &&
        !serverRoleCanAdminister(current) &&
        serverSupportsCapability(current, MESSAGE_DELETE_CAPABILITY) &&
        serverSupportsCapability(current, AGENT_ACCESS_CAPABILITY)
        ? current.id
        : null;
    },
    ...desktopAgentLevels,
  };
}
