import type { MessagingConnection, MessagingDesktopApi } from "@openbot/contracts/ipc";
import { sourceText } from "@openbot/i18n/source";
import { clone } from "./mock-support";

const PREVIEW_WORKSPACE = { workspaceId: "T0PREVIEW", workspaceName: "Preview workspace" };

/** The Slack workspaces of the preview host. Connecting Slack connects a preview workspace at once. */
export function createMockMessaging(agentName: (agentId: string) => string | undefined): MessagingDesktopApi {
  const connections = new Map<string, MessagingConnection>();
  const change = (workspaceId: string, update: Partial<MessagingConnection>) => {
    const current = connections.get(workspaceId);
    if (!current) throw new Error(sourceText("error.messaging.notConnected"));
    connections.set(workspaceId, { ...current, ...update });
  };
  return {
    getSlackOverview: async () => clone({ connections: [...connections.values()] }),
    connectSlackWorkspace: async () => {
      connections.set(PREVIEW_WORKSPACE.workspaceId, {
        ...PREVIEW_WORKSPACE,
        platform: "slack",
        enabled: true,
        state: "connected",
        botUserId: "U0PREVIEW",
        missingScopes: [],
        retryAt: null,
        credentials: "saved",
        routerAgentId: null,
        agentIds: [],
      });
    },
    disconnectSlackWorkspace: async ({ workspaceId }) => {
      connections.delete(workspaceId);
    },
    reconnectSlackWorkspace: async ({ workspaceId }) => change(workspaceId, { enabled: true, state: "connected" }),
    setSlackEnabled: async ({ workspaceId, enabled }) =>
      change(workspaceId, { enabled, state: enabled ? "connected" : "paused" }),
    setSlackRouting: async ({ workspaceId, routerAgentId, agentIds }) => {
      for (const agentId of [routerAgentId, ...agentIds])
        if (agentId && !agentName(agentId)) throw new Error(sourceText("error.team.agentNotFound"));
      change(workspaceId, { routerAgentId, agentIds });
    },
  };
}
