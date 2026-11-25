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

type WorkspacePlatform = Exclude<MessagingPlatform, "telegram" | "whatsapp">;

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

const PREVIEW_ROLES: readonly MessagingRole[] = [
  { id: "200000000000000001", name: "Admin" },
  { id: "200000000000000002", name: "Moderator" },
  { id: "200000000000000003", name: "Member" },
];

const TELEGRAM_LINK_MS = 1_500;

const WHATSAPP_LINK_READS = 4;
const WHATSAPP_QR_READS = 2;

const PREVIEW_WHATSAPP_GROUPS: readonly WhatsAppGroup[] = [
  { id: "120363000000000001@g.us", name: "Family" },
  { id: "120363000000000002@g.us", name: "Book club" },
  { id: "120363000000000003@g.us", name: "Acme team" },
];

const PREVIEW_WHATSAPP_STRANGER = { senderId: "447700900555", name: "Grace Hopper" };

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
  const allowedRoles = new Map<string, MessagingRole[]>();
  const chats = new Map<string, MessagingConnection>();
  let telegramOrchestrator: string | null = null;
  let linkedChats = 0;
  const changeChat = (workspaceId: string, update: Partial<MessagingConnection>) => {
    const current = chats.get(workspaceId);
    if (!current) throw new Error(sourceText("error.messaging.notConnected"));
    chats.set(workspaceId, { ...current, ...update });
  };
  const numbers = new Map<string, MessagingConnection>();
  const accounts = new Map<string, WhatsAppAccount>();
  let whatsappOrchestrator: string | null = null;
  let linkedNumbers = 0;
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
    const before = accounts.get(workspaceId);
    accounts.set(workspaceId, {
      workspaceId,
      ownNumber: input.ownNumber,
      workingMessage: before?.workingMessage ?? true,
      statusReactions: before?.statusReactions ?? true,
      allowedSenders: before?.allowedSenders ?? [],
      pendingRequests: [],
    });
    if (!input.ownNumber)
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
      const id = sender.kind === "contact" ? parseWhatsAppPhoneNumber(sender.id) : sender.id;
      if (!id) throw new Error("A messaging request is invalid.");
      const others = current.allowedSenders.filter((allowed) => allowed.id !== id);
      if (others.length >= MESSAGING_LIMITS.allowedSenders)
        throw new Error(sourceText("error.messaging.whatsappTooManySenders"));
      accounts.set(workspaceId, {
        ...current,
        allowedSenders: [...others, { id, kind: sender.kind, name: sender.name.trim() || id, readOnly: false }],
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
              { id: request.senderId, kind: "contact", name: request.name || request.senderId, readOnly: false },
            ]
          : current.allowedSenders,
      });
    },
    setWhatsAppOwnNumber: async ({ workspaceId, ownNumber }) => {
      accounts.set(workspaceId, { ...account(workspaceId), ownNumber });
    },
    setWhatsAppWorkingMessage: async ({ workspaceId, workingMessage }) => {
      accounts.set(workspaceId, { ...account(workspaceId), workingMessage });
    },
    setWhatsAppStatusReactions: async ({ workspaceId, statusReactions }) => {
      accounts.set(workspaceId, { ...account(workspaceId), statusReactions });
    },
    setWhatsAppSenderReadOnly: async ({ workspaceId, senderId, readOnly }) => {
      const current = account(workspaceId);
      if (!current.allowedSenders.some((sender) => sender.id === senderId))
        throw new Error(sourceText("error.messaging.whatsappSenderNotFound"));
      accounts.set(workspaceId, {
        ...current,
        allowedSenders: current.allowedSenders.map((sender) =>
          sender.id === senderId ? { ...sender, readOnly } : sender,
        ),
      });
    },
  };
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
    hostGetWhatsAppOverview: () => api.getWhatsAppOverview(),
    hostStartWhatsAppLink: (input) => api.startWhatsAppLink(input),
    hostGetWhatsAppLinkState: () => api.getWhatsAppLinkState(),
    hostCancelWhatsAppLink: () => api.cancelWhatsAppLink(),
    hostDisconnectWhatsAppNumber: (input) => api.disconnectWhatsAppNumber(input),
    hostReconnectWhatsAppNumber: (input) => api.reconnectWhatsAppNumber(input),
    hostSetWhatsAppEnabled: (input) => api.setWhatsAppEnabled(input),
    hostAddWhatsAppOrchestrator: () => api.addWhatsAppOrchestrator({}),
    hostListWhatsAppGroups: (input) => api.listWhatsAppGroups(input),
    hostAddWhatsAppSender: (input) => api.addWhatsAppSender(input),
    hostRemoveWhatsAppSender: (input) => api.removeWhatsAppSender(input),
    hostAnswerWhatsAppRequest: (input) => api.answerWhatsAppRequest(input),
    hostSetWhatsAppOwnNumber: (input) => api.setWhatsAppOwnNumber(input),
    hostSetWhatsAppWorkingMessage: (input) => api.setWhatsAppWorkingMessage(input),
    hostSetWhatsAppStatusReactions: (input) => api.setWhatsAppStatusReactions(input),
    hostSetWhatsAppSenderReadOnly: (input) => api.setWhatsAppSenderReadOnly(input),
  };
}
