import type { GroupApi, IpcEndpoints, RemoteWorkspaceCache } from "@openbot/contracts/ipc";
import { clone } from "./mock-support";

/**
 * The saved copy of joined servers, held in memory. It starts off, as in the app, and turning it off
 * deletes every copy. The preview has no account switch, so the copy is keyed by server only.
 */
export function createMockRemoteWorkspaceCache(): GroupApi<IpcEndpoints["remoteWorkspaceCache"]> {
  let enabled = false;
  const copies = new Map<string, RemoteWorkspaceCache>();
  return {
    getPreference: async () => ({ enabled }),
    setPreference: async (preference) => {
      enabled = preference.enabled;
      if (!enabled) copies.clear();
      return { enabled };
    },
    read: async (serverId) => clone(copies.get(serverId) ?? null),
    saveWorkspace: async (input) => {
      if (!enabled) return;
      const agentIds = new Set(input.agents.map((agent) => agent.id));
      copies.set(input.serverId, {
        serverId: input.serverId,
        savedAt: new Date().toISOString(),
        memberId: input.memberId,
        agents: clone(input.agents),
        reads: clone(input.reads),
        layout: clone(input.layout),
        conversations: (copies.get(input.serverId)?.conversations ?? []).filter((conversation) =>
          agentIds.has(conversation.agentId),
        ),
      });
    },
    saveConversation: async (input) => {
      const copy = copies.get(input.serverId);
      if (!enabled || !copy?.agents.some((agent) => agent.id === input.agentId)) return;
      copy.conversations = [
        { agentId: input.agentId, messages: clone(input.messages.slice(-30)) },
        ...copy.conversations.filter((conversation) => conversation.agentId !== input.agentId),
      ].slice(0, 5);
    },
  };
}
