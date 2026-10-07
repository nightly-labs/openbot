import type { MessagingConnection, MessagingDesktopApi, MessagingPlatform } from "@openbot/contracts/ipc";
import { sourceText } from "@openbot/i18n/source";
import { clone } from "./mock-support";

const PREVIEW_WORKSPACE = {
  slack: {
    workspaceId: "T0PREVIEW",
    workspaceName: "Preview workspace",
    botUserId: "U0PREVIEW",
  },
  discord: {
    workspaceId: "100000000000000001",
    workspaceName: "Preview Discord server",
    botUserId: "100000000000000002",
  },
  telegram: {
    workspaceId: "tg_preview_bot",
    workspaceName: "@PreviewBot",
    botUserId: "123456",
  },
} as const satisfies Record<MessagingPlatform, { workspaceId: string; workspaceName: string; botUserId: string }>;

/**
 * The Slack workspaces and Discord servers of the preview host. Connecting connects a preview
 * workspace at once. `orchestrator` names the preview agent that stands in for the orchestrator.
 */
export function createMockMessaging(orchestrator: () => string): MessagingDesktopApi {
  const platform = (name: MessagingPlatform, notConnected: string) => {
    const connections = new Map<string, MessagingConnection>();
    const change = (workspaceId: string, update: Partial<MessagingConnection>) => {
      const current = connections.get(workspaceId);
      if (!current) throw new Error(notConnected);
      connections.set(workspaceId, { ...current, ...update });
    };
    return {
      overview: async () => clone({ connections: [...connections.values()] }),
      connect: async () => {
        connections.set(PREVIEW_WORKSPACE[name].workspaceId, {
          ...PREVIEW_WORKSPACE[name],
          platform: name,
          enabled: true,
          state: "connected",
          missingScopes: [],
          retryAt: null,
          credentials: "saved",
          orchestratorAgentId: null,
        });
      },
      disconnect: async ({ workspaceId }: { workspaceId: string }) => {
        connections.delete(workspaceId);
      },
      reconnect: async ({ workspaceId }: { workspaceId: string }) =>
        change(workspaceId, { enabled: true, state: "connected" }),
      setEnabled: async ({ workspaceId, enabled }: { workspaceId: string; enabled: boolean }) =>
        change(workspaceId, {
          enabled,
          state: enabled ? "connected" : "paused",
        }),
      addOrchestrator: async ({ workspaceId }: { workspaceId: string }) => {
        const agentId = orchestrator();
        change(workspaceId, { orchestratorAgentId: agentId });
        return { agentId, sectionId: null };
      },
    };
  };
  const slack = platform("slack", sourceText("error.messaging.notConnected"));
  const discord = platform("discord", sourceText("error.messaging.discordNotConnected"));
  const telegramConnections = new Map<string, MessagingConnection>();
  const changeTelegram = (workspaceId: string, update: Partial<MessagingConnection>) => {
    const current = telegramConnections.get(workspaceId);
    if (!current) throw new Error(sourceText("error.messaging.notConnected"));
    telegramConnections.set(workspaceId, { ...current, ...update });
  };
  return {
    getSlackOverview: slack.overview,
    connectSlackWorkspace: slack.connect,
    disconnectSlackWorkspace: slack.disconnect,
    reconnectSlackWorkspace: slack.reconnect,
    setSlackEnabled: slack.setEnabled,
    addSlackOrchestrator: slack.addOrchestrator,
    getDiscordOverview: discord.overview,
    connectDiscordGuild: discord.connect,
    disconnectDiscordGuild: discord.disconnect,
    reconnectDiscordGuild: discord.reconnect,
    setDiscordEnabled: discord.setEnabled,
    addDiscordOrchestrator: discord.addOrchestrator,
    getTelegramOverview: async () => clone({ connections: [...telegramConnections.values()] }),
    connectTelegram: async () => {
      telegramConnections.set(PREVIEW_WORKSPACE.telegram.workspaceId, {
        ...PREVIEW_WORKSPACE.telegram,
        platform: "telegram",
        enabled: true,
        state: "connected",
        missingScopes: [],
        retryAt: null,
        credentials: "saved",
        orchestratorAgentId: orchestrator(),
      });
    },
    disconnectTelegram: async ({ workspaceId }: { workspaceId: string }) => {
      telegramConnections.delete(workspaceId);
    },
    reconnectTelegram: async ({ workspaceId }: { workspaceId: string }) =>
      changeTelegram(workspaceId, { enabled: true, state: "connected" }),
    setTelegramEnabled: async ({ workspaceId, enabled }: { workspaceId: string; enabled: boolean }) =>
      changeTelegram(workspaceId, {
        enabled,
        state: enabled ? "connected" : "paused",
      }),
    setTelegramAgent: async ({ workspaceId, agentId }: { workspaceId: string; agentId: string | null }) => {
      changeTelegram(workspaceId, { orchestratorAgentId: agentId });
    },
  };
}
