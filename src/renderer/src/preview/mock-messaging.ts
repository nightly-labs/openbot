import type {
  MessagingConnection,
  MessagingDesktopApi,
  MessagingPlatform,
  MessagingRole,
} from "@openbot/contracts/ipc";
import { sourceText } from "@openbot/i18n/source";
import { clone } from "./mock-support";

/** The platforms whose preview adds a workspace for each connect. Telegram has a chat for each link. */
type WorkspacePlatform = Exclude<MessagingPlatform, "telegram">;

/** The preview workspace of the `count`th connect. The first keeps the names that stories show. */
const PREVIEW_WORKSPACE = {
  slack: (count: number) => ({
    workspaceId: count === 1 ? "T0PREVIEW" : `T0PREVIEW${count}`,
    workspaceName: count === 1 ? "Preview workspace" : `Preview workspace ${count}`,
    botUserId: "U0PREVIEW",
  }),
  discord: (count: number) => ({
    workspaceId: String(100000000000000001n + BigInt(count - 1)),
    workspaceName: count === 1 ? "Preview Discord server" : `Preview Discord server ${count}`,
    botUserId: "100000000000000002",
  }),
} as const satisfies Record<
  WorkspacePlatform,
  (count: number) => { workspaceId: string; workspaceName: string; botUserId: string }
>;

/** The roles of every preview Discord server, highest first. */
const PREVIEW_ROLES: readonly MessagingRole[] = [
  { id: "200000000000000001", name: "Admin" },
  { id: "200000000000000002", name: "Moderator" },
  { id: "200000000000000003", name: "Member" },
];

/** The time Telegram takes in the preview before a chat links: the user picks the chat there. */
const TELEGRAM_LINK_MS = 1_500;

/**
 * The Slack workspaces, Discord servers and Telegram chats of the preview host. Connecting Slack or
 * Discord connects a preview workspace at once. A Telegram link adds a preview chat after a moment,
 * as the user picks it in Telegram. `orchestrator` names the preview agent that stands in for the
 * orchestrators.
 */
export function createMockMessaging(orchestrator: () => string): MessagingDesktopApi {
  const platform = (name: WorkspacePlatform, notConnected: string) => {
    const connections = new Map<string, MessagingConnection>();
    let connects = 0;
    const change = (workspaceId: string, update: Partial<MessagingConnection>) => {
      const current = connections.get(workspaceId);
      if (!current) throw new Error(notConnected);
      connections.set(workspaceId, { ...current, ...update });
    };
    return {
      overview: async () => clone({ connections: [...connections.values()] }),
      connect: async () => {
        connects += 1;
        const workspace = PREVIEW_WORKSPACE[name](connects);
        connections.set(workspace.workspaceId, {
          ...workspace,
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
        change(workspaceId, { enabled, state: enabled ? "connected" : "paused" }),
      addOrchestrator: async ({ workspaceId }: { workspaceId: string }) => {
        const agentId = orchestrator();
        change(workspaceId, { orchestratorAgentId: agentId });
        return { agentId, sectionId: null };
      },
      connected: (workspaceId: string) => {
        if (!connections.has(workspaceId)) throw new Error(notConnected);
      },
    };
  };
  const slack = platform("slack", sourceText("error.messaging.notConnected"));
  const discord = platform("discord", sourceText("error.messaging.discordNotConnected"));
  /** The roles that each preview Discord server allows. None lets everyone. */
  const allowedRoles = new Map<string, MessagingRole[]>();
  const chats = new Map<string, MessagingConnection>();
  /** One orchestrator answers every Telegram chat, so a new chat gets it too. */
  let telegramOrchestrator: string | null = null;
  let linkedChats = 0;
  const changeChat = (workspaceId: string, update: Partial<MessagingConnection>) => {
    const current = chats.get(workspaceId);
    if (!current) throw new Error(sourceText("error.messaging.notConnected"));
    chats.set(workspaceId, { ...current, ...update });
  };
  const api: Omit<MessagingDesktopApi, `host${string}`> = {
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
    getDiscordAccess: async ({ workspaceId }) => {
      discord.connected(workspaceId);
      return clone({ allowedRoles: allowedRoles.get(workspaceId) ?? [] });
    },
    listDiscordRoles: async ({ workspaceId }) => {
      discord.connected(workspaceId);
      return clone({ roles: [...PREVIEW_ROLES] });
    },
    setDiscordAccess: async ({ workspaceId, allowedRoles: roles }) => {
      discord.connected(workspaceId);
      allowedRoles.set(workspaceId, clone(roles));
      return clone({ allowedRoles: roles });
    },
    getTelegramOverview: async () => clone({ connections: [...chats.values()] }),
    connectTelegramChat: async ({ place }) => {
      linkedChats += 1;
      const count = linkedChats;
      // Telegram gives a group a negative chat ID, and a direct chat a positive one.
      const chat =
        place === "group"
          ? { workspaceId: `-100${count}`, workspaceName: `Preview group ${count}` }
          : { workspaceId: `${700_000 + count}`, workspaceName: `Preview chat ${count}` };
      setTimeout(() => {
        chats.set(chat.workspaceId, {
          ...chat,
          platform: "telegram",
          enabled: true,
          state: "connected",
          botUserId: "7000000000",
          missingScopes: [],
          retryAt: null,
          credentials: "saved",
          orchestratorAgentId: telegramOrchestrator,
        });
      }, TELEGRAM_LINK_MS);
    },
    disconnectTelegramChat: async ({ workspaceId }) => {
      chats.delete(workspaceId);
    },
    reconnectTelegramChat: async ({ workspaceId }) => changeChat(workspaceId, { enabled: true, state: "connected" }),
    setTelegramEnabled: async ({ workspaceId, enabled }) =>
      changeChat(workspaceId, { enabled, state: enabled ? "connected" : "paused" }),
    addTelegramOrchestrator: async () => {
      const agentId = orchestrator();
      telegramOrchestrator = agentId;
      for (const workspaceId of chats.keys()) changeChat(workspaceId, { orchestratorAgentId: agentId });
      return { agentId, sectionId: null };
    },
  };
  // The preview has one host, so a joined server's connections are the same ones.
  const overview = { slack: api.getSlackOverview, discord: api.getDiscordOverview, telegram: api.getTelegramOverview };
  return {
    ...api,
    hostOverview: ({ platform }) => overview[platform](),
    hostConnect: ({ platform, place }) =>
      platform === "slack"
        ? api.connectSlackWorkspace()
        : platform === "discord"
          ? api.connectDiscordGuild()
          : api.connectTelegramChat({ place: place ?? "group" }),
    hostDisconnect: ({ platform, workspaceId }) =>
      platform === "slack"
        ? api.disconnectSlackWorkspace({ workspaceId })
        : platform === "discord"
          ? api.disconnectDiscordGuild({ workspaceId })
          : api.disconnectTelegramChat({ workspaceId }),
    hostReconnect: ({ platform, workspaceId }) =>
      platform === "slack"
        ? api.reconnectSlackWorkspace({ workspaceId })
        : platform === "discord"
          ? api.reconnectDiscordGuild({ workspaceId })
          : api.reconnectTelegramChat({ workspaceId }),
    hostSetEnabled: ({ platform, ...input }) =>
      platform === "slack"
        ? api.setSlackEnabled(input)
        : platform === "discord"
          ? api.setDiscordEnabled(input)
          : api.setTelegramEnabled(input),
    hostAddOrchestrator: ({ platform, workspaceId }) =>
      platform === "telegram" || workspaceId === null
        ? api.addTelegramOrchestrator({})
        : platform === "slack"
          ? api.addSlackOrchestrator({ workspaceId })
          : api.addDiscordOrchestrator({ workspaceId }),
    hostGetDiscordAccess: (input) => api.getDiscordAccess(input),
    hostListDiscordRoles: (input) => api.listDiscordRoles(input),
    hostSetDiscordAccess: (input) => api.setDiscordAccess(input),
  };
}
