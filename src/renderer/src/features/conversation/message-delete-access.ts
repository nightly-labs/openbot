import type { AgentAccessLevel, AgentAccessLevels, AgentAccessSnapshot, ServerSummary } from "@openbot/contracts/ipc";
import { AGENT_ACCESS_CAPABILITY } from "@openbot/contracts/team-protocol/agent-access-v1";
import { MESSAGE_DELETE_CAPABILITY } from "@openbot/contracts/team-protocol/message-delete-v1";
import type { AgentMessage } from "@openbot/ui/data";
import { createEffect, createSignal } from "solid-js";
import { serverRoleCanAdminister, serverSupportsCapability } from "../servers/server-capabilities";
import { conversationPort } from "./conversation-port";
import { PENDING_SEND_ID_PREFIX } from "./stores/pending-send-store";

/**
 * Whether the reader can delete a message, as the host decides it (`message-delete-v1`). A member
 * can delete a message that they sent. `deleteAny` is true when the reader can also delete the other
 * messages: this computer, manage access to the agent, or an admin of the server for a channel. The
 * host checks it again. A message that the host does not store yet cannot be deleted.
 */
export function readerCanDeleteMessage(
  message: AgentMessage,
  access: { deleteAny: boolean; isOwnSender: (senderId: string) => boolean },
): boolean {
  // A `ui-` row is an error that only this window shows.
  if (message.streaming || message.id.startsWith(PENDING_SEND_ID_PREFIX) || message.id.startsWith("ui-")) return false;
  if (access.deleteAny) return true;
  const sender = message.author === "you" ? message.senderMember : undefined;
  return sender !== undefined && access.isOwnSender(sender.id);
}

/** Where the access levels of a member come from. */
export interface AgentLevelsSource {
  /** The joined server whose levels decide, or null when they do not: no member, or no level route. */
  levelsServerId: () => string | null;
  readLevels: (serverId: string) => Promise<AgentAccessSnapshot>;
  /** Calls `listener` each time the levels on `serverId` change. Returns the function that stops it. */
  onLevelsChanged: (serverId: string, listener: () => void) => () => void;
}

/** Where the levels that decide Delete in an agent's chat come from. */
export interface AgentMessageDeleteAccessSource extends AgentLevelsSource {
  /** This computer, or an owner or admin of the server: they delete any message. */
  deletesAny: () => boolean;
}

/**
 * The level of the member for each agent of `levelsServerId`, read again after each change. Undefined
 * until the levels load, after a failed read, and when no server decides.
 */
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
          // The caller keeps the actions that need no level.
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

/**
 * Whether the reader can delete any message of an agent's chat: this computer, an owner or admin,
 * or a member with manage access to the agent. A member's levels are read again after each change.
 * Until they load, and on a host without them, a member can delete only their own messages.
 */
export function createAgentMessageDeleteAccess(source: AgentMessageDeleteAccessSource) {
  const level = createAgentLevels(source);
  return (agentId: string | undefined): boolean =>
    source.deletesAny() || (agentId !== undefined && level(agentId) === "manage");
}

/** Reads the levels of a joined server through preload, and reads them again on `agent-access-changed`. */
export const desktopAgentLevels: Pick<AgentLevelsSource, "readLevels" | "onLevelsChanged"> = {
  readLevels: (serverId) => conversationPort().hostAdmin.getAgentAccess(serverId),
  onLevelsChanged: (serverId, listener) =>
    conversationPort().agent.onScopedEvent((scoped) => {
      if (scoped.serverId === serverId && scoped.event.type === "agent-access-changed") listener();
    }),
};

/** The levels of the desktop's active server, read through preload. */
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
