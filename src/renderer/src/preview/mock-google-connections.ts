import type { GoogleConnectionSummary, GoogleConnectionsSnapshot, OpenBotDesktopApi } from "@openbot/contracts/ipc";
/** Preview accounts are fictional and never contact Google. */
export function createMockGoogleConnections(
  agents: () => readonly { id: string; name: string }[],
): OpenBotDesktopApi["googleConnections"] {
  const profiles: GoogleConnectionSummary[] = [];
  const state = (): GoogleConnectionsSnapshot => ({
    configured: true,
    canConfigure: true,
    profiles: profiles.map((p) => ({ ...p })),
    eligibleAgents: agents().map(({ id, name }) => ({ id, name })),
    templates: [],
  });
  return {
    state: async () => state(),
    configure: async () => state(),
    signIn: async ({ profileId }) => {
      let profile = profiles.find((p) => p.id === profileId);
      if (!profile) {
        profile = {
          id: `google-preview-${profiles.length + 1}`,
          email: `member${profiles.length + 1}@example.com`,
          connected: false,
          signingIn: false,
          agentId: null,
          agentName: null,
          eligibleAgentIds: agents().map((a) => a.id),
          error: null,
        };
        profiles.push(profile);
      }
      profile.connected = true;
      return state();
    },
    assign: async ({ profileId, agentId }) => {
      const p = profiles.find((p) => p.id === profileId);
      const agent = agents().find((a) => a.id === agentId);
      if (!p || !agent) throw new Error("Unknown preview connection.");
      p.agentId = agent.id;
      p.agentName = agent.name;
      return state();
    },
    disconnect: async ({ profileId }) => {
      const p = profiles.find((p) => p.id === profileId);
      if (p) {
        p.connected = false;
        p.agentId = null;
        p.agentName = null;
      }
      return state();
    },
    cancel: async () => {},
    page: async () => null,
    open: async () => {},
    paste: async () => {},
  };
}
