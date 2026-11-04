import type {
  AddMessagingOrchestratorResult,
  ConnectorMessagingPlatform,
  DiscordAccess,
  DiscordRoleList,
  MessagingDesktopApi,
  MessagingOverview,
  MessagingRole,
} from "@openbot/contracts/ipc";
import { sourceText } from "@openbot/i18n/source";
import type { AgentProfile } from "@openbot/ui/data";
import type {
  DiscordAccessControl,
  SlackOrchestratorChoice,
  SlackOrchestratorModels,
  WorkspacePlatform,
} from "@openbot/ui/features/settings/SlackIntegrationPanel";
import type { TelegramChatPlace } from "@openbot/ui/features/settings/TelegramIntegrationPanel";
import { currentText } from "@openbot/ui/text";
import { createSignal, createStore, untrack } from "solid-js";
import {
  type ConnectorAnalyticsAction,
  type ConnectorController,
  createConnectorActions,
} from "./connector-controller";

/** A Slack or Discord connect installs the app in a new workspace; a Telegram one opens a chat. */
type MessagingConnectTarget = { platform: WorkspacePlatform } | { platform: "telegram"; place: TelegramChatPlace };

/** A Slack workspace or a Discord server has its own orchestrator; every Telegram chat shares one. */
type MessagingOrchestratorTarget = { platform: WorkspacePlatform; workspaceId: string } | { platform: "telegram" };

/**
 * The Slack, Discord and Telegram connections of one place: this computer or a joined server. WhatsApp
 * has its own controller (`whatsapp-connector.ts`): only this computer links it.
 */
export interface MessagingApi {
  overview: (platform: ConnectorMessagingPlatform) => Promise<MessagingOverview>;
  connect: (target: MessagingConnectTarget) => Promise<void>;
  disconnect: (platform: ConnectorMessagingPlatform, workspaceId: string) => Promise<void>;
  reconnect: (platform: ConnectorMessagingPlatform, workspaceId: string) => Promise<void>;
  setEnabled: (platform: ConnectorMessagingPlatform, workspaceId: string, enabled: boolean) => Promise<void>;
  addOrchestrator: (
    target: MessagingOrchestratorTarget,
    choice: SlackOrchestratorChoice | null,
  ) => Promise<AddMessagingOrchestratorResult>;
  /** Who can use OpenBot in a Discord server. */
  discordAccess: (workspaceId: string) => Promise<DiscordAccess>;
  /** The roles of a Discord server to choose from. */
  discordRoles: (workspaceId: string) => Promise<DiscordRoleList>;
  setDiscordAccess: (workspaceId: string, allowedRoles: MessagingRole[]) => Promise<DiscordAccess>;
}

/** The connections of this computer, through main. Read on each call: tests and stories replace `window.openbot`. */
export function localMessagingApi(messaging: () => MessagingDesktopApi = () => window.openbot.messaging): MessagingApi {
  return {
    overview: (platform) =>
      platform === "slack"
        ? messaging().getSlackOverview()
        : platform === "discord"
          ? messaging().getDiscordOverview()
          : messaging().getTelegramOverview(),
    connect: (target) =>
      target.platform === "telegram"
        ? messaging().connectTelegramChat({ place: target.place })
        : target.platform === "slack"
          ? messaging().connectSlackWorkspace()
          : messaging().connectDiscordGuild(),
    disconnect: (platform, workspaceId) =>
      platform === "slack"
        ? messaging().disconnectSlackWorkspace({ workspaceId })
        : platform === "discord"
          ? messaging().disconnectDiscordGuild({ workspaceId })
          : messaging().disconnectTelegramChat({ workspaceId }),
    reconnect: (platform, workspaceId) =>
      platform === "slack"
        ? messaging().reconnectSlackWorkspace({ workspaceId })
        : platform === "discord"
          ? messaging().reconnectDiscordGuild({ workspaceId })
          : messaging().reconnectTelegramChat({ workspaceId }),
    setEnabled: (platform, workspaceId, enabled) =>
      platform === "slack"
        ? messaging().setSlackEnabled({ workspaceId, enabled })
        : platform === "discord"
          ? messaging().setDiscordEnabled({ workspaceId, enabled })
          : messaging().setTelegramEnabled({ workspaceId, enabled }),
    addOrchestrator: (target, choice) =>
      target.platform === "telegram"
        ? messaging().addTelegramOrchestrator({ ...(choice ?? {}) })
        : target.platform === "slack"
          ? messaging().addSlackOrchestrator({ workspaceId: target.workspaceId, ...(choice ?? {}) })
          : messaging().addDiscordOrchestrator({ workspaceId: target.workspaceId, ...(choice ?? {}) }),
    discordAccess: (workspaceId) => messaging().getDiscordAccess({ workspaceId }),
    discordRoles: (workspaceId) => messaging().listDiscordRoles({ workspaceId }),
    setDiscordAccess: (workspaceId, allowedRoles) => messaging().setDiscordAccess({ workspaceId, allowedRoles }),
  };
}

/** How often a page reads the connections while it shows: a connection changes on its own. */
const POLL_MS = 3_000;

const ACTION_FAILED = {
  slack: "connector.slack.actionFailed",
  discord: "connector.discord.actionFailed",
  telegram: "connector.telegram.actionFailed",
} as const satisfies Record<ConnectorMessagingPlatform, string>;

/**
 * A joined server without `discord-access-v1` cannot choose roles. Its Discord servers let everyone.
 * Electron puts the IPC channel in front of the message, so only the end is compared.
 */
function isDiscordAccessUnsupported(error: unknown): boolean {
  return error instanceof Error && error.message.endsWith(sourceText("error.team.discordAccessUnsupported"));
}

export interface MessagingConnectorOptions {
  /** Every agent of the place, to find each orchestrator. */
  agents: () => AgentProfile[];
  /** The joined server's name, when the connections are that server's. */
  hostName?: () => string | undefined;
  /** The joined server the connections belong to. One controller serves each joined server in turn. */
  serverId?: () => string | undefined;
  /** The catalog for the orchestrator's model picker, or undefined to start on a new agent's default. */
  models?: () => SlackOrchestratorModels | undefined;
  /** Called with the sidebar section that main put a new orchestrator in. */
  onOrchestratorSection?: (sectionId: string) => void;
}

/**
 * The Slack workspaces, Discord servers or Telegram chats of one place. Main and a host send no
 * event for a connection, and a connect ends in the browser or in Telegram, so a page that shows the
 * state calls `watch`. Each action reads the connections again when it ends.
 */
export function createMessagingConnector(
  platform: ConnectorMessagingPlatform,
  api: MessagingApi,
  options: MessagingConnectorOptions,
): ConnectorController {
  /**
   * The last read of one server's connections. A failed read keeps the overview of an earlier read of
   * the same server, and `error` says why it failed. With no overview, the state is not known.
   */
  const [loaded, setLoaded] = createSignal<{
    serverId: string | undefined;
    overview: MessagingOverview | null;
    error: string | null;
  } | null>(null);
  // Another server's connections are not shown, also when this server's read fails.
  const current = () => {
    const last = loaded();
    return last && last.serverId === options.serverId?.() ? last : null;
  };
  const overview = () => current()?.overview ?? null;
  const actions = createConnectorActions(ACTION_FAILED[platform], platform);
  /** Each read replaces the one before it, so a slow answer never overwrites a newer one. */
  let reads = 0;

  /** Who can use OpenBot in each Discord server of one server. Discord only. */
  const [access, setAccess] = createStore<{
    serverId: string | undefined;
    allowed: Record<string, MessagingRole[]>;
    unsupported: boolean;
  }>({ serverId: undefined, allowed: {}, unsupported: false });
  /** The Discord servers whose roles this view asked for. A view that opens asks again. */
  let requested = new Set<string>();
  /** The Discord servers whose failed read already showed a toast. The next poll reads them again. */
  const reported = new Set<string>();
  const loadAccess = (serverId: string | undefined, workspaceIds: readonly string[]) => {
    if (access.serverId !== serverId) {
      requested = new Set();
      setAccess((draft) => {
        draft.serverId = serverId;
        draft.allowed = {};
        draft.unsupported = false;
      });
    }
    if (access.unsupported) return;
    for (const workspaceId of workspaceIds) {
      if (requested.has(workspaceId)) continue;
      requested.add(workspaceId);
      void api.discordAccess(workspaceId).then(
        (next) => {
          if (actions.disposed() || access.serverId !== serverId) return;
          reported.delete(workspaceId);
          setAccess((draft) => {
            draft.allowed[workspaceId] = next.allowedRoles;
          });
        },
        (error: unknown) => {
          if (actions.disposed() || access.serverId !== serverId) return;
          if (isDiscordAccessUnsupported(error)) {
            setAccess((draft) => {
              draft.unsupported = true;
            });
            return;
          }
          // One toast for each server; the next poll reads it again.
          requested.delete(workspaceId);
          if (reported.has(workspaceId)) return;
          reported.add(workspaceId);
          actions.report(error);
        },
      );
    }
  };

  // The page shows a failed read with Retry. The next poll or action also reads again.
  const reload = () => {
    const read = ++reads;
    const serverId = untrack(() => options.serverId?.());
    void api
      .overview(platform)
      .then((next) => {
        if (actions.disposed() || read !== reads) return;
        setLoaded({ serverId, overview: next, error: null });
        if (platform === "discord")
          loadAccess(
            serverId,
            next.connections.map((connection) => connection.workspaceId),
          );
      })
      .catch((error: unknown) => {
        if (actions.disposed() || read !== reads) return;
        const { t, errorMessage } = currentText();
        const last = untrack(loaded);
        setLoaded({
          serverId,
          overview: last && last.serverId === serverId ? last.overview : null,
          error: errorMessage(error, t("connector.readFailed")),
        });
      });
  };
  const run = (action: () => Promise<unknown>, track?: ConnectorAnalyticsAction) =>
    actions.run(action, { settled: reload, ...(track ? { track } : {}) });
  const addOrchestrator = (target: MessagingOrchestratorTarget, choice: SlackOrchestratorChoice | null) =>
    run(async () => {
      const { sectionId } = await api.addOrchestrator(target, choice);
      if (sectionId) options.onOrchestratorSection?.(sectionId);
    });
  const connections = () => overview()?.connections ?? [];
  const shared = {
    disconnect: (workspaceId: string) => run(() => api.disconnect(platform, workspaceId), "disconnected"),
    /** Disconnects every connection that shows, one after another, in one action. */
    disconnectAll: () => {
      const workspaceIds = untrack(connections).map((connection) => connection.workspaceId);
      run(async () => {
        for (const workspaceId of workspaceIds) await api.disconnect(platform, workspaceId);
      }, "disconnected");
    },
    reconnect: (workspaceId: string) => run(() => api.reconnect(platform, workspaceId), "connect_started"),
    setEnabled: (workspaceId: string, enabled: boolean) =>
      run(() => api.setEnabled(platform, workspaceId, enabled), enabled ? "enabled" : "disabled"),
  };
  const base = {
    ready: () => current() !== null,
    available: () => true,
    busy: actions.busy,
    reload,
    watch: () => {
      requested = new Set();
      reload();
      const timer = setInterval(reload, POLL_MS);
      return () => clearInterval(timer);
    },
  };

  if (platform === "telegram")
    return {
      ...base,
      id: platform,
      detail: {
        id: platform,
        props: {
          get agents() {
            return options.agents();
          },
          get connections() {
            return connections();
          },
          get busy() {
            return actions.busy();
          },
          get models() {
            return options.models?.();
          },
          get hostName() {
            return options.hostName?.();
          },
          get loadError() {
            return current()?.error ?? null;
          },
          onRetry: reload,
          onConnectChat: (place) =>
            new Promise<boolean>((resolve) => {
              let opened = false;
              actions.run(() => api.connect({ platform, place }), {
                track: "connect_started",
                done: () => {
                  opened = true;
                },
                settled: () => {
                  reload();
                  resolve(opened);
                },
              });
            }),
          onDisconnectChat: shared.disconnect,
          onDisconnectAll: shared.disconnectAll,
          onReconnect: shared.reconnect,
          onSetEnabled: shared.setEnabled,
          onAddOrchestrator: (choice) => addOrchestrator({ platform }, choice),
        },
      },
    };

  const connect = () => run(() => api.connect({ platform }), "connect_started");
  const discordAccess: DiscordAccessControl = {
    allowed: (workspaceId) => access.allowed[workspaceId] ?? null,
    loadRoles: async (workspaceId) => (await api.discordRoles(workspaceId)).roles,
    onSave: (workspaceId, roles) =>
      run(async () => {
        const serverId = untrack(() => options.serverId?.());
        const next = await api.setDiscordAccess(workspaceId, roles);
        if (access.serverId !== serverId) return;
        setAccess((draft) => {
          draft.allowed[workspaceId] = next.allowedRoles;
        });
      }),
    get unsupported() {
      return access.unsupported;
    },
  };
  return {
    ...base,
    id: platform,
    connect,
    detail: {
      id: platform,
      props: {
        platform,
        get agents() {
          return options.agents();
        },
        get connections() {
          return connections();
        },
        get busy() {
          return actions.busy();
        },
        get models() {
          return options.models?.();
        },
        get hostName() {
          return options.hostName?.();
        },
        get loadError() {
          return current()?.error ?? null;
        },
        onRetry: reload,
        onConnectWorkspace: connect,
        onDisconnectWorkspace: shared.disconnect,
        onDisconnectAll: shared.disconnectAll,
        onReconnect: shared.reconnect,
        onSetEnabled: shared.setEnabled,
        onAddOrchestrator: (workspaceId, choice) => addOrchestrator({ platform, workspaceId }, choice),
        access: platform === "discord" ? discordAccess : undefined,
      },
    },
  };
}
