import {
  MESSAGING_LIMITS,
  type MessagingConnection,
  type MessagingDesktopApi,
  type MessagingPlatform,
  type MessagingRole,
  parseWhatsAppPhoneNumber,
  type StartWhatsAppLinkInput,
  type WhatsAppAccount,
  type WhatsAppGroup,
  type WhatsAppLinkState,
} from "@openbot/contracts/ipc";
import { sourceText } from "@openbot/i18n/source";
import { clone } from "./mock-support";

/**
 * The platforms whose preview adds a workspace for each connect. Telegram has a chat for each link,
 * and WhatsApp a number for each phone that links.
 */
type WorkspacePlatform = Exclude<MessagingPlatform, "telegram" | "whatsapp">;

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

/** The reads of a WhatsApp link before the preview phone links it: a few seconds of the code. */
const WHATSAPP_LINK_READS = 4;
/** The reads between two QR codes. WhatsApp changes the code about every 20 seconds. */
const WHATSAPP_QR_READS = 2;

/** The groups of every preview WhatsApp number. */
const PREVIEW_WHATSAPP_GROUPS: readonly WhatsAppGroup[] = [
  { id: "120363000000000001@g.us", name: "Family" },
  { id: "120363000000000002@g.us", name: "Book club" },
  { id: "120363000000000003@g.us", name: "Acme team" },
];

/** The person who writes to a preview number only for OpenBot, a moment after it links. */
const PREVIEW_WHATSAPP_STRANGER = { senderId: "447700900555", name: "Grace Hopper" };

/**
 * The Slack workspaces, Discord servers, Telegram chats and WhatsApp numbers of the preview host.
 * Connecting Slack or Discord connects a preview workspace at once. A Telegram link adds a preview chat
 * after a moment, as the user picks it in Telegram. A WhatsApp link shows a QR code or a pairing code,
 * and the preview phone links after a few reads; on a number only for OpenBot, a person then writes and
 * waits for the owner. `orchestrator` names the preview agent that stands in for the orchestrators.
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
  const numbers = new Map<string, MessagingConnection>();
  const accounts = new Map<string, WhatsAppAccount>();
  /** One orchestrator answers every WhatsApp number, so a new number gets it too. */
  let whatsappOrchestrator: string | null = null;
  let linkedNumbers = 0;
  /** The link that runs, the choice it started with, and how often the dialog read it. */
  let link: { state: WhatsAppLinkState; input: StartWhatsAppLinkInput; reads: number } | null = null;
  const previewQr = (rotation: number) =>
    `2@openbot-preview-${linkedNumbers + 1}-${rotation},openbot-preview-noise-key,openbot-preview-identity-key,preview`;
  const changeNumber = (workspaceId: string, update: Partial<MessagingConnection>) => {
    const current = numbers.get(workspaceId);
    if (!current) throw new Error(sourceText("error.messaging.whatsappNotConnected"));
    numbers.set(workspaceId, { ...current, ...update });
  };
  const account = (workspaceId: string) => {
    const current = accounts.get(workspaceId);
    if (!current) throw new Error(sourceText("error.messaging.whatsappNotConnected"));
    return current;
  };
  /** The preview phone links: the number and its settings are there, and the link reads `linked`. */
  const linkNumber = (input: StartWhatsAppLinkInput): string => {
    linkedNumbers += 1;
    const count = linkedNumbers;
    const workspaceId = input.phoneNumber ?? `4477009001${String(count).padStart(2, "0")}`;
    numbers.set(workspaceId, {
      workspaceId,
      platform: "whatsapp",
      enabled: true,
      state: "connected",
      workspaceName: count === 1 ? "Preview phone" : `Preview phone ${count}`,
      botUserId: workspaceId,
      missingScopes: [],
      retryAt: null,
      credentials: "saved",
      orchestratorAgentId: whatsappOrchestrator,
    });
    // A number that links again keeps the people it allowed.
    const before = accounts.get(workspaceId);
    accounts.set(workspaceId, {
      workspaceId,
      ownNumber: input.ownNumber,
      allowedSenders: before?.allowedSenders ?? [],
      pendingRequests: [],
    });
    if (!input.ownNumber)
      // A person writes to the new number and gets a code to give the owner.
      setTimeout(() => {
        const current = accounts.get(workspaceId);
        if (!current || current.ownNumber) return;
        accounts.set(workspaceId, {
          ...current,
          pendingRequests: [
            {
              ...PREVIEW_WHATSAPP_STRANGER,
              code: `K7Q${String(count).padStart(3, "0")}`,
              expiresAt: new Date(Date.now() + 60 * 60 * 1_000).toISOString(),
            },
          ],
        });
      }, TELEGRAM_LINK_MS);
    return workspaceId;
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
    getWhatsAppOverview: async () => clone({ connections: [...numbers.values()], accounts: [...accounts.values()] }),
    startWhatsAppLink: async (input) => {
      link = {
        input: clone(input),
        reads: 0,
        state: {
          status: "waiting",
          qr: input.method === "qr" ? previewQr(0) : null,
          code: input.method === "code" ? `PRVW${String(linkedNumbers + 1).padStart(4, "0")}` : null,
          workspaceId: null,
          error: null,
        },
      };
      return clone(link.state);
    },
    getWhatsAppLinkState: async () => {
      if (!link) return { status: "idle", qr: null, code: null, workspaceId: null, error: null };
      if (link.state.status === "waiting") {
        link.reads += 1;
        if (link.reads >= WHATSAPP_LINK_READS)
          link.state = { status: "linked", qr: null, code: null, workspaceId: linkNumber(link.input), error: null };
        else if (link.state.qr !== null)
          link.state = { ...link.state, qr: previewQr(Math.floor(link.reads / WHATSAPP_QR_READS)) };
      }
      return clone(link.state);
    },
    cancelWhatsAppLink: async () => {
      link = null;
    },
    disconnectWhatsAppNumber: async ({ workspaceId }) => {
      numbers.delete(workspaceId);
      accounts.delete(workspaceId);
    },
    reconnectWhatsAppNumber: async ({ workspaceId }) =>
      changeNumber(workspaceId, { enabled: true, state: "connected" }),
    setWhatsAppEnabled: async ({ workspaceId, enabled }) =>
      changeNumber(workspaceId, { enabled, state: enabled ? "connected" : "paused" }),
    addWhatsAppOrchestrator: async () => {
      const agentId = orchestrator();
      whatsappOrchestrator = agentId;
      for (const workspaceId of numbers.keys()) changeNumber(workspaceId, { orchestratorAgentId: agentId });
      return { agentId, sectionId: null };
    },
    listWhatsAppGroups: async ({ workspaceId }) => {
      account(workspaceId);
      return clone({ groups: [...PREVIEW_WHATSAPP_GROUPS] });
    },
    addWhatsAppSender: async ({ workspaceId, sender }) => {
      const current = account(workspaceId);
      // Main keeps a contact's number in digits, and a sender with no name under its number.
      const id = sender.kind === "contact" ? parseWhatsAppPhoneNumber(sender.id) : sender.id;
      if (!id) throw new Error("A messaging request is invalid.");
      const others = current.allowedSenders.filter((allowed) => allowed.id !== id);
      if (others.length >= MESSAGING_LIMITS.allowedSenders)
        throw new Error(sourceText("error.messaging.whatsappTooManySenders"));
      accounts.set(workspaceId, {
        ...current,
        allowedSenders: [...others, { id, kind: sender.kind, name: sender.name.trim() || id }],
      });
    },
    removeWhatsAppSender: async ({ workspaceId, senderId }) => {
      const current = account(workspaceId);
      accounts.set(workspaceId, {
        ...current,
        allowedSenders: current.allowedSenders.filter((sender) => sender.id !== senderId),
      });
    },
    answerWhatsAppRequest: async ({ workspaceId, code, approve }) => {
      const current = account(workspaceId);
      const request = current.pendingRequests.find((pending) => pending.code === code);
      if (!request) throw new Error(sourceText("error.messaging.whatsappRequestEnded"));
      accounts.set(workspaceId, {
        ...current,
        pendingRequests: current.pendingRequests.filter((pending) => pending.code !== code),
        allowedSenders: approve
          ? [
              ...current.allowedSenders.filter((sender) => sender.id !== request.senderId),
              { id: request.senderId, kind: "contact", name: request.name || request.senderId },
            ]
          : current.allowedSenders,
      });
    },
    setWhatsAppOwnNumber: async ({ workspaceId, ownNumber }) => {
      accounts.set(workspaceId, { ...account(workspaceId), ownNumber });
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
