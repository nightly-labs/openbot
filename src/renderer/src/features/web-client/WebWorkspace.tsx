import {
  type AccountUsage,
  type AddedAgent,
  type AgentApproval,
  type AgentEvent,
  type AgentModelOption,
  type AgentStatus,
  type AppInfo,
  type BrowserTakeoverRequest,
  CHANNEL_CHATS_CAPABILITY,
  type ServerConnectionState,
  type ServerSummary,
} from "@openbot/contracts/ipc";
import { CONTEXT_RESET_CAPABILITY } from "@openbot/contracts/team-protocol/context-reset-v1";
import { HOST_UPDATE_CAPABILITY } from "@openbot/contracts/team-protocol/host-update-v1";
import { readHostAnalytics } from "@openbot/team-client";
import {
  cancelHostUpdate,
  checkHostForUpdate,
  clearStorage,
  deleteStoredFile,
  getAgentAdminSettings,
  getHostUpdateStatus,
  getStorageUsage,
  setHostUpdateSettings,
  startHostUpdate,
  updateAgentAdminSettings,
} from "@openbot/team-client/team-admin-requests";
import { clearAgentContext, type TeamApiRequest } from "@openbot/team-client/team-api-requests";
import {
  Alert,
  AlertActions,
  AlertContent,
  AlertDescription,
  AlertTitle,
  Button,
  hasVisibleToasts,
  toast,
} from "@openbot/ui";
import type { AgentMessage } from "@openbot/ui/data";
import { AccountDock } from "@openbot/ui/features/account/AccountDock";
import { computeAgentAvatarMoods } from "@openbot/ui/features/agents/agent-avatar-mood";
import { createFirstAgentDraft, type FirstAgentDraft } from "@openbot/ui/features/agents/FirstAgentSetup";
import { ServerRail } from "@openbot/ui/features/servers/ServerRail";
import { Sidebar } from "@openbot/ui/features/sidebar/Sidebar";
import { computeSidebarAgentStates } from "@openbot/ui/features/sidebar/sidebar-agent-states";
import { useText } from "@openbot/ui/text";
import { createEffect, createMemo, createSignal, onCleanup, onSettled, Show, untrack } from "solid-js";
import { toAgentMessage, toAgentMessages } from "../../app-message-projection";
import { playCompletionSoundForAgentEvent } from "../../completion-sound";
import { isGlobalSearchShortcut } from "../../global-search-shortcut";
import { LayoutProvider, useLayout } from "../../layout";
import { PlatformProvider } from "../../platform";
import { WorkspaceFrame } from "../../WorkspaceFrame";
import {
  ChannelCreateOverlay,
  GlobalSearchOverlay,
  JoinServerOverlay,
  MarketplaceOverlay,
  ServerSettingsOverlay,
  SharedAgentInstallOverlay,
} from "../../WorkspaceOverlayViews";
import { claimErrorToast, readableAgentError } from "../agents/agent-error-text";
import { createRemoteAgentAdmin, updateRemoteAgent } from "../agents/remote-agent-admin";
import { ChannelConversation } from "../channels/ChannelConversation";
import { readChannelSelection, writeChannelSelection } from "../channels/channel-selection";
import { isOwnChannelAuthor } from "../channels/channel-timeline";
import { ChannelsControllerProvider } from "../channels/channels-context";
import { createChannelsController } from "../channels/channels-controller";
import { Conversation, createConversationController } from "../conversation/Conversation";
import { clearStoredQueueEdit } from "../conversation/composer-draft";
import { ConversationControllerProvider } from "../conversation/conversation-controller-context";
import { composerDraftKey } from "../conversation/conversation-keys";
import type { FilesPort } from "../files/files-port";
import { watchHostUpdate } from "../servers/host-update-toast";
import type { ServerSettingsSection } from "../servers/ServerSettingsModal";
import type { HostUpdateCalls } from "../servers/ServerUpdatePanel";
import { remoteAdminServer } from "../servers/server-capabilities";
import { AgentUsagePanel } from "../usage/AgentUsagePanel";
import type { UsagePort } from "../usage/usage-port";
import { WebAgentSettings } from "./WebAgentSettings";
import { WebConnectComputer } from "./WebConnectComputer";
import { WebHostOffline } from "./WebHostOffline";
import { WebMobileNavigation, type WebMobilePane } from "./WebMobileNavigation";
import { createWebAccountCalls } from "./web-account";
import { createWebChannelsPort } from "./web-channels-runtime";
import { createWebWorkspace, type WebRuntimeFactory } from "./web-client-context";
import { createWebConversationRuntime } from "./web-conversation-runtime";
import { createWebFileSaver } from "./web-file-download";
import { createWebAgentTemplateCalls, createWebMarketplaceCalls } from "./web-marketplace";
import { createWebProviderSettings, openWebDestination } from "./web-provider-admin";
import { createWebServerSettings } from "./web-server-settings";

const CONNECTING_STATUS: AgentStatus = {
  phase: "starting",
  cliVersion: null,
  auth: { kind: "unknown" },
  capabilities: { chat: "unavailable", browser: "unavailable", computerUse: "unavailable" },
  message: null,
  fullAccess: true,
};
/**
 * What the web client reports as its build. The browser has no main process to ask, and the web frame
 * uses the macOS geometry: the account dock beside the rail is the hybrid one.
 */
const WEB_APP_INFO: AppInfo = { name: "OpenBot", version: "web", platform: "darwin", variant: "production" };
/** Below this width the web shows one pane at a time; see `web-client.css`. */
const PHONE_QUERY = "(max-width: 720px)";
/** The account whose queue edit the browser may hold under `QUEUE_EDIT_STORAGE_KEY`. */
const QUEUE_EDIT_ACCOUNT_KEY = "openbot.web.queue-edit-account";

/** The host names attachment previews with the desktop `openbot-attachment:` scheme, which a browser cannot load. */
function withoutPreviewUrls(message: AgentMessage): AgentMessage {
  if (!message.attachments) return message;
  return { ...message, attachments: message.attachments.map((attachment) => ({ ...attachment, previewUrl: null })) };
}

function newAgentAvatar(): Pick<FirstAgentDraft, "avatarSeed" | "avatarHue"> {
  const { avatarSeed, avatarHue } = createFirstAgentDraft();
  return { avatarSeed, avatarHue };
}

type WebWorkspaceProps = {
  accountId: string;
  accountEmail?: string;
  accountName?: string | null;
  accountAvatarUrl?: string | null;
  accountFetch: typeof fetch;
  onSessionCheck: () => Promise<void>;
  /** True when the account session has ended, so closing sends no remote session end. */
  accountSessionEnded?: () => boolean;
  onLogout: () => Promise<void>;
  createRuntime?: WebRuntimeFactory;
  /** A shared agent that a `/app?agent=<id>` link named. The dialog installs it only on a press. */
  agentTemplateId?: string | null;
  onAgentTemplateClose?: () => void;
  /** An invitation that a `/app` link named. The join dialog opens on it and still asks before it joins. */
  inviteUrl?: string | null;
  onInviteClose?: () => void;
  /** A plugin listing that a `/app?plugin=<slug>` link named. The marketplace opens on it. */
  pluginSlug?: string | null;
  onPluginSlugConsumed?: () => void;
};

export function WebWorkspace(props: WebWorkspaceProps) {
  return (
    <PlatformProvider appInfo={WEB_APP_INFO}>
      <LayoutProvider>
        <WebWorkspaceFrame {...props} />
      </LayoutProvider>
    </PlatformProvider>
  );
}

function WebWorkspaceFrame(props: WebWorkspaceProps) {
  const { t, sourceText } = useText();
  const layout = useLayout();
  const [status, setStatus] = createSignal<AgentStatus>(CONNECTING_STATUS);
  const [models, setModels] = createSignal<AgentModelOption[]>([]);
  /**
   * Each model read takes the next number. A list is shown only when no later read has been shown,
   * so a slow first read cannot replace the list that a ready status read again. A host change marks
   * every number up to now as shown, so a list read for the previous host is dropped.
   */
  let modelsRequest = 0;
  let modelsShown = 0;
  function showModels(request: number, list: AgentModelOption[]): void {
    if (request <= modelsShown) return;
    modelsShown = request;
    setModels(list);
  }
  const workspace = createWebWorkspace(props, {
    onStatus: (next) => {
      setStatus(next);
      // As in the desktop app: a ready status can follow a provider sign-in or a new endpoint, so
      // the models are read again.
      if (next.phase !== "ready") return;
      const request = ++modelsRequest;
      workspace.runtime.models().then(
        (list) => showModels(request, list),
        () => undefined,
      );
    },
  });
  // A stored queue edit holds message text of the account that opened it. Another account must not restore it.
  try {
    if (window.localStorage.getItem(QUEUE_EDIT_ACCOUNT_KEY) !== props.accountId) clearStoredQueueEdit();
    window.localStorage.setItem(QUEUE_EDIT_ACCOUNT_KEY, props.accountId);
  } catch {
    clearStoredQueueEdit();
  }
  /** As on desktop: the host shows the other members which agent this account is writing to. */
  function setTyping(agentId: string, typing: boolean): void {
    workspace.runtime.setTyping(typing ? agentId : null, typing);
  }
  const controller = createConversationController({ onTypingChange: setTyping });
  /**
   * Releases an open queue edit on the connected host first, so its message can run after sign-out.
   * When the host does not confirm, the stored edit stays for this account, which can release it after sign-in.
   */
  async function signOut() {
    const agentId = controller.editingAgentId();
    const deliveryId = controller.editingDeliveryId();
    const editId = controller.editingEditId();
    if (
      agentId &&
      deliveryId &&
      editId &&
      workspace.state.status === "online" &&
      controller.editingServerId() === workspace.state.host?.hostId
    ) {
      try {
        await workspace.runtime.editQueue({ agentId, action: "cancel", deliveryId, editId });
        // The controller stores an open edit when it closes. Clear it first, so sign-out leaves no text.
        controller.setEditingEditId(null);
        clearStoredQueueEdit();
      } catch {
        // Sign-out continues with the edit stored.
      }
    }
    await props.onLogout();
  }
  /** The host list was read and holds no computer to connect to. */
  const noHost = () => !workspace.state.host && (workspace.state.hostsLoaded || Boolean(workspace.state.hostsError));
  const hostOffline = () => !noHost() && workspace.state.status !== "online";
  let resetRevocation = workspace.state.revocationRevision;
  createEffect(
    () => ({ host: workspace.state.host?.hostId, revocation: workspace.state.revocationRevision }),
    ({ revocation }) => {
      const revoked = revocation !== resetRevocation;
      resetRevocation = revocation;
      controller.setComposerErrors({});
      controller.setConversationErrors({});
      // A queue edit holds its message on its host until Save or Cancel. Keep the edit and its draft
      // after a reload or a host change, so the user can release the hold on that host.
      const editAgentId = untrack(controller.editingAgentId);
      const editServerId = untrack(controller.editingServerId);
      if (!revoked && editAgentId && editServerId) {
        const key = composerDraftKey({ agentId: editAgentId, serverId: editServerId });
        controller.setDrafts((drafts) => (drafts[key] ? { [key]: drafts[key] } : {}));
        return;
      }
      clearStoredQueueEdit();
      controller.setDrafts({});
      controller.setEditingDraftBackup(null);
      controller.setEditingOriginalAttachmentIds([]);
      controller.setEditingPendingSave(null);
      controller.setEditingAgentId(null);
      controller.setEditingServerId(null);
      controller.setEditingEditId(null);
      controller.setEditingDeliveryId(null);
    },
  );
  const [accountUsage, setAccountUsage] = createSignal<AccountUsage | null>(null);
  let usageGeneration = 0;
  const [joinOpen, setJoinOpen] = createSignal(false);
  const [creating, setCreating] = createSignal(false);
  /** The new agent form's avatar. The first-agent row in an empty sidebar shows it. */
  const [agentAvatar, setAgentAvatar] = createSignal(newAgentAvatar());
  const [mobilePane, setMobilePane] = createSignal<WebMobilePane>("conversation");
  const [settingsRequest, setSettingsRequest] = createSignal<{ agentId: string; nonce: number } | null>(null);
  const [profileRequest, setProfileRequest] = createSignal<{ agentId: string; nonce: number } | null>(null);
  const account = createMemo(() => ({
    id: props.accountId,
    email: props.accountEmail ?? "",
    name: props.accountName ?? null,
    avatarUrl: props.accountAvatarUrl ?? null,
  }));
  const accountCalls = createWebAccountCalls(props.accountFetch, props.onSessionCheck);
  /* As in the desktop dock: the reading is taken again when a provider connects or disconnects. */
  const usageTargetKey = createMemo(() => {
    const hostId = workspace.state.host?.hostId;
    if (!hostId || !workspace.runtime.accountUsage || workspace.state.status !== "online") return null;
    const connected = (status().providers ?? [])
      .filter((item) => item.state === "available" && item.connectionState !== "connecting")
      .map((item) => item.id)
      .sort()
      .join(",");
    return `${hostId}:${connected}`;
  });
  // As on desktop: a reading is for one host and one set of connected providers.
  createEffect(usageTargetKey, () => {
    setAccountUsage(null);
  });
  const usageReady = createMemo(() => {
    const current = status();
    return (
      workspace.state.status === "online" &&
      (current.phase === "ready" ||
        Boolean(current.providers?.some((item) => item.state === "available" && item.connectionState !== "connecting")))
    );
  });
  // The composer shows the usage-limit notice with the account menu closed, so read once for each target.
  createEffect(
    () => (usageReady() ? usageTargetKey() : null),
    (target) => {
      if (target) void refreshUsage().catch(() => undefined);
    },
  );
  /** The opened host has its own connection. Another host shows its status connection, as on mobile. */
  function hostState(hostId: string): ServerConnectionState {
    if (hostId === workspace.state.host?.hostId) return workspace.state.status;
    const state = workspace.state.hostStates[hostId];
    // Without status connections (no BroadcastChannel), nothing will report this host.
    if (!workspace.runtime.hosts) return "offline";
    return !state || state === "unknown" ? "connecting" : state;
  }
  const servers = createMemo<ServerSummary[]>(() =>
    workspace.orderedHosts().map((host) => {
      const active = host.hostId === workspace.state.host?.hostId;
      const incompatibility =
        active && workspace.state.incompatibility?.hostId === host.hostId ? workspace.state.incompatibility : null;
      return {
        id: host.hostId,
        name: host.name,
        kind: "remote",
        role: host.role,
        apiUrl: null,
        logoUrl: host.logoKey
          ? `/api/browser/v2/remote/hosts/${encodeURIComponent(host.hostId)}/logo?v=${encodeURIComponent(host.logoKey)}`
          : null,
        active,
        state: incompatibility ? "incompatible" : hostState(host.hostId),
        notificationsMuted: false,
        notificationsMutedUntil: null,
        notificationLevel: "all",
        remoteDesktopAvailable: false,
        compatibility: {
          localAppVersion: "web",
          hostAppVersion: incompatibility?.hostAppVersion ?? null,
          localProtocol: { minimum: 3, maximum: 3 },
          hostProtocol: incompatibility?.hostProtocol ?? null,
          negotiatedProtocol: incompatibility ? null : 3,
          capabilities: workspace.state.capabilities,
        },
        issue: incompatibility
          ? { code: incompatibility.code, message: incompatibility.message, retryable: true }
          : null,
      };
    }),
  );
  const server = createMemo(() => servers().find((item) => item.active));
  const blockedServer = createMemo(() => {
    const current = server();
    return current?.state === "incompatible" ? current : null;
  });
  // A phone shows the sidebar as a full pane, so it is never compact there.
  const phoneQuery = window.matchMedia?.(PHONE_QUERY);
  const [phone, setPhone] = createSignal(phoneQuery?.matches ?? false);
  onSettled(() => {
    const update = (event: MediaQueryListEvent) => setPhone(event.matches);
    phoneQuery?.addEventListener("change", update);
    return () => phoneQuery?.removeEventListener("change", update);
  });
  const compact = () => !phone() && layout.leftPanelCompact();
  /** The usage report of the connected host. As on desktop, it follows a host switch. */
  const [usage, setUsage] = createSignal<{ trigger: HTMLElement | null } | null>(null);
  // The compatibility screen wins over the report, so its Retry stays in reach.
  const usageOpen = () => usage() !== null && server() !== undefined && !blockedServer();
  /** Only the connected host answers, so another host is connected first, as for its settings. */
  async function openUsage(serverId: string, trigger: HTMLElement | null): Promise<void> {
    if (server()?.id !== serverId) {
      const host = workspace.state.hosts.find((item) => item.hostId === serverId);
      if (!host) return;
      await workspace.connect(host);
      if (server()?.id !== serverId) return;
    }
    setMobilePane("conversation");
    setUsage({ trigger });
  }
  function closeUsage() {
    const trigger = usage()?.trigger;
    setUsage(null);
    queueMicrotask(() => {
      if (trigger?.isConnected) trigger.focus({ preventScroll: true });
    });
  }
  const usageServerListeners = new Set<(servers: ServerSummary[]) => void>();
  createEffect(
    () => workspace.state.status,
    (state) => {
      if (state === "online") for (const listener of usageServerListeners) listener(untrack(servers));
    },
  );
  const usageCalls: UsagePort = {
    agent: {
      getHostAnalytics: (input, serverId) =>
        readHostAnalytics(hostRequest(serverId), workspace.state.capabilities, input),
      listAgents: () => workspace.runtime.listAgents(),
      onScopedEvent: (listener) =>
        workspace.onHostEvent((event) => {
          if (event.type === "turn-completed") listener({ serverId: workspace.state.host?.hostId ?? "", event });
        }),
    },
    servers: {
      onEvent: (listener) => {
        usageServerListeners.add(listener);
        return () => usageServerListeners.delete(listener);
      },
    },
  };
  onCleanup(
    workspace.onHostEvent((event) => {
      if (event.type === "turn-completed") playCompletionSoundForAgentEvent(event, workspace.state.agents);
      // As on desktop: the host sends a new reading when a provider reports usage.
      if (event.type === "usage-changed" && untrack(usageTargetKey)) {
        usageGeneration += 1;
        setAccountUsage(event.usage);
      }
    }),
  );
  const [searchOpen, setSearchOpen] = createSignal(false);
  const [messageFocusRequest, setMessageFocusRequest] = createSignal<{
    agentId: string;
    messageId: string;
    nonce: number;
  } | null>(null);
  onSettled(() => {
    const toggleSearch = (event: KeyboardEvent) => {
      if (!isGlobalSearchShortcut(event)) return;
      event.preventDefault();
      event.stopImmediatePropagation();
      setSearchOpen((open) => !open);
    };
    window.addEventListener("keydown", toggleSearch);
    return () => window.removeEventListener("keydown", toggleSearch);
  });
  async function searchAllMessages(query: string) {
    if (workspace.state.status !== "online") return [];
    const page = await workspace.runtime.search(undefined, query);
    return page.results.map((result) => ({
      agentId: result.agentId,
      message: toAgentMessage(result.message, result.agentId),
    }));
  }
  /** Opens an agent at one message, for a global search result and a stored file's message. */
  async function openMessage(agentId: string, messageId: string) {
    setMobilePane("conversation");
    await workspace.run(async () => {
      await select(agentId);
      if (workspace.state.selectedId !== agentId) return;
      await workspace.openSearchMessage(messageId);
      setMessageFocusRequest({ agentId, messageId, nonce: Date.now() });
    });
  }
  /** The admin requests of the connected host. A call for another server is refused, not redirected. */
  function hostRequest(serverId?: string): TeamApiRequest {
    const admin = workspace.runtime.admin;
    const current = untrack(server);
    if (!admin || !current || (serverId !== undefined && serverId !== current.id))
      throw new Error(t("webClient.error.connectServerFirst"));
    return admin.request;
  }
  const providerSettings = createWebProviderSettings({
    server: () => (workspace.runtime.admin ? server() : undefined),
    request: hostRequest,
    status,
    setStatus,
    readStatus: () => workspace.runtime.status(),
  });
  const runtime = createWebConversationRuntime(
    workspace.runtime,
    () => workspace.state.host?.hostId ?? "",
    workspace.runtime.admin ? () => hostRequest() : undefined,
    workspace.onHostEvent,
  );
  const remoteAgentAdmin = createRemoteAgentAdmin(
    () => {
      const current = server();
      const agent = workspace.selected();
      return current && agent ? { server: current, agentId: agent.id } : null;
    },
    () => ({
      getAgentAdminSettings: (agentId, serverId) => getAgentAdminSettings(hostRequest(serverId), agentId),
      updateAgentAdminSettings: (input, serverId) => updateAgentAdminSettings(hostRequest(serverId), input),
    }),
  );
  /** The Team API agent summary has no access, so the agent shows the host's answer. */
  const conversationAgent = createMemo(() => {
    const agent = workspace.selected();
    const settings = remoteAgentAdmin.settings();
    return agent && settings ? { ...agent, access: settings.access } : agent;
  });
  const serverSettings = createWebServerSettings({
    server,
    admin: () => workspace.runtime.admin,
    presence: () => workspace.state.presence,
    refreshHosts: () => workspace.refreshHosts(),
  });
  const marketplaceCalls = createWebMarketplaceCalls(props.accountFetch, hostRequest);
  const agentTemplateCalls = createWebAgentTemplateCalls(props.accountFetch, hostRequest);
  const [marketplaceOpen, setMarketplaceOpen] = createSignal(false);
  // A link opens its overlay once it has arrived, which can be after sign-in.
  createEffect(
    () => props.inviteUrl,
    (inviteUrl) => {
      if (inviteUrl) setJoinOpen(true);
    },
  );
  createEffect(
    () => props.pluginSlug,
    (slug) => {
      if (slug) setMarketplaceOpen(true);
    },
  );
  const saveFile = createWebFileSaver();
  const storageCalls: FilesPort = {
    agent: { listAgents: () => workspace.runtime.listAgents() },
    storage: {
      // The host names previews with the desktop `openbot-attachment:` scheme, as it does in chat.
      getUsage: async (input, serverId) => {
        const usage = await getStorageUsage(hostRequest(serverId), input);
        return { ...usage, files: usage.files.map((file) => ({ ...file, previewUrl: null })) };
      },
      deleteFile: (input, serverId) => deleteStoredFile(hostRequest(serverId), input),
      clear: (input, serverId) => clearStorage(hostRequest(serverId), input),
      // A stored file is an attachment. The browser has no app to open it in, so it downloads.
      openFile: async (input, serverId) => {
        hostRequest(serverId);
        saveFile(await workspace.runtime.download(input.fileId));
      },
    },
  };
  const hostUpdateCalls: HostUpdateCalls = {
    getUpdateStatus: async (serverId) => getHostUpdateStatus(hostRequest(serverId)),
    checkForUpdate: async (serverId) => checkHostForUpdate(hostRequest(serverId)),
    startUpdate: async (restart, serverId) => startHostUpdate(hostRequest(serverId), restart),
    cancelUpdate: async (serverId) => cancelHostUpdate(hostRequest(serverId)),
    setUpdateSettings: async (settings, serverId) => setHostUpdateSettings(hostRequest(serverId), settings),
  };
  const [serverSettingsSection, setServerSettingsSection] = createSignal<ServerSettingsSection | null>(null);
  async function openServerSettings(
    serverId: string,
    trigger: HTMLElement | null,
    section: ServerSettingsSection | null = null,
  ): Promise<void> {
    if (server()?.id !== serverId || workspace.state.status !== "online") {
      const host = workspace.state.hosts.find((item) => item.hostId === serverId);
      if (!host) return;
      await workspace.connect(host);
      if (server()?.id !== serverId || workspace.state.status !== "online") return;
    }
    setServerSettingsSection(section);
    serverSettings.open(trigger);
  }
  // An admin learns about a new version, or sees the download that runs, each time the host connects.
  createEffect(
    () => {
      const current = server();
      // An id, not an object: the summary is rebuilt on each host change, and one read is enough.
      return current?.state === "online" && remoteAdminServer(current, HOST_UPDATE_CAPABILITY) ? current.id : null;
    },
    (serverId) => {
      if (!serverId) return;
      watchHostUpdate({
        serverId,
        name: untrack(() => server()?.name) ?? "",
        calls: hostUpdateCalls,
        openUpdates: () => void openServerSettings(serverId, null, "updates"),
      });
    },
  );
  const channelsPort = createWebChannelsPort(
    workspace.runtime,
    workspace.onHostEvent,
    () => workspace.state.host?.hostId ?? "",
  );
  const channelsSupported = () =>
    workspace.state.status === "online" &&
    workspace.state.capabilities.includes(CHANNEL_CHATS_CAPABILITY) &&
    Boolean(workspace.runtime.channels);
  const savedChannelId = () => {
    const hostId = workspace.state.host?.hostId;
    return hostId ? (readChannelSelection()[props.accountId]?.[hostId] ?? null) : null;
  };
  // On a small screen the sidebar pane covers the chat, and so does the usage report. A covered
  // message was not seen.
  const canMarkRead = () => document.hasFocus() && mobilePane() === "conversation" && !usageOpen();
  const channels = createChannelsController({
    port: () => channelsPort,
    agents: workspace.profiles,
    // A host switch and a revoked session start the list again. A dropped connection does not: the
    // open channel and its draft stay, and the effect below reads the list again when the host is back.
    scopeKey: () => `${workspace.state.host?.hostId ?? ""}:${workspace.state.revocationRevision}`,
    readSelection: savedChannelId,
    writeSelection: (channelId) => {
      const hostId = workspace.state.host?.hostId;
      if (hostId) writeChannelSelection(props.accountId, hostId, channelId);
    },
    supported: channelsSupported,
    deletionSupported: () => workspace.state.host?.role === "owner" || workspace.state.host?.role === "admin",
    beforeOpen: () => {
      setCreating(false);
      setUsage(null);
      setMessageFocusRequest(null);
    },
    canMarkRead,
  });
  onCleanup(
    workspace.onHostEvent((event) => {
      if (event.type === "channels-changed" || event.type === "runtime-snapshot") void channels.refresh();
    }),
  );
  // As on desktop: an agent's error is the banner above its composer, and the newest one replaces
  // the last. An error with no agent is a toast, once per text in 30 seconds. The host redacts the
  // message before it sends it.
  onCleanup(
    workspace.onHostEvent((event) => {
      if (event.type !== "error") return;
      const serverId = server()?.id;
      if (event.agentId && serverId) {
        const key = composerDraftKey({ agentId: event.agentId, serverId });
        controller.setConversationErrors((current) => ({ ...current, [key]: readableAgentError(event.message) }));
        return;
      }
      const description = readableAgentError(event.message);
      if (claimErrorToast(description)) toast.error(t("webClient.error.hostReported"), { description });
    }),
  );
  // The scope starts before the host is online, so the first connection opens the saved channel here.
  createEffect(channelsSupported, (supported) => {
    if (!supported) return;
    const saved = savedChannelId();
    if (channels.state.selectedId === null && saved !== null) void channels.open(saved);
    else void channels.refresh();
  });
  const channelOpen = () => channels.state.selectedId !== null;
  const createSupported = () => workspace.state.status === "online" && workspace.state.host !== null;
  /** A host with no agents. The first-agent form opens there by itself, as in the desktop app. */
  const firstAgent = () => workspace.state.agentsLoaded && workspace.profiles().length === 0 && createSupported();
  /** An open channel still takes the pane, as a channel closes the desktop form. */
  const agentFormOpen = () => creating() || (firstAgent() && !channelOpen());
  // The host reports the new agent before the create call returns. Hold the form open until the
  // save is done, so the new-agent avatar still changes after it.
  createEffect(firstAgent, (first) => {
    if (first && !untrack(channelOpen)) setCreating(true);
  });
  const readState = () => workspace.conversation()?.page?.readState;
  // Keyed on the newest loaded message, not on the read state: the host can count a message that
  // this page has not loaded yet, and marking the same message again would not clear it. Focus
  // coming back reads the page again.
  createEffect(
    () =>
      (readState()?.unreadCount ?? 0) > 0 && !agentFormOpen() && !channelOpen() && canMarkRead()
        ? (workspace.conversation()?.page?.messages.at(-1)?.id ?? null)
        : null,
    (unread) => {
      if (unread) void workspace.markRead().catch(() => toast.error(t("chat.unread.markReadFailed")));
    },
  );
  const channelApprovals = createMemo(() => {
    const approvals: Record<string, AgentApproval | undefined> = {};
    for (const approval of workspace.state.approvals) approvals[approval.agentId] = approval;
    return approvals;
  });
  const channelTakeovers = createMemo(() => {
    const takeovers: Record<string, BrowserTakeoverRequest | undefined> = {};
    for (const request of workspace.state.takeovers) takeovers[request.agentId] = request;
    return takeovers;
  });
  const sidebarActivity = createMemo(() => {
    // The agent conversation shows only the waits of the agent's own thread. A wait in a channel
    // thread stays out of "Needs you", because selecting the row cannot answer it.
    const agentThreads = new Map(workspace.state.agents.map((agent) => [agent.id, agent.threadId]));
    const inAgentThread = (item: { agentId: string; threadId?: string }) =>
      item.threadId !== undefined && agentThreads.get(item.agentId) === item.threadId;
    return {
      agentIds: workspace.state.agents.map((agent) => agent.id),
      activeTurns: Object.fromEntries(
        Object.entries(workspace.state.conversations).map(([id, conversation]) => [
          id,
          workspace.state.status === "online" ? (conversation.page?.activeTurnId ?? null) : null,
        ]),
      ),
      queues: workspace.state.queues,
      unreadReplies: {},
      recentReplies: {},
      failedTurns: {},
      // One wait per agent: a question replaces a browser takeover for the same agent.
      pendingPrompts: Object.fromEntries([
        ...workspace.state.takeovers
          .filter(inAgentThread)
          .map((request) => [request.agentId, { type: "browser-takeover-requested", request } as const] as const),
        ...workspace.state.prompts.filter(inAgentThread).map((prompt) => [prompt.agentId, prompt] as const),
      ]),
      pendingApprovals: Object.fromEntries(
        workspace.state.approvals.filter(inAgentThread).map((approval) => [approval.agentId, approval]),
      ),
    };
  });
  const sidebarAgentStates = createMemo(() => computeSidebarAgentStates(sidebarActivity()));
  const sidebarAgentMoods = createMemo(() => computeAgentAvatarMoods(sidebarActivity()));
  const browserEnabled = createMemo(
    () =>
      workspace.state.status === "online" &&
      workspace.state.capabilities.includes("browser-control") &&
      workspace.state.capabilities.includes("browser-view"),
  );
  const browserTakeover = createMemo(() => {
    const agent = workspace.selected();
    if (!agent) return undefined;
    return workspace.state.takeovers.find(
      (request) => request.agentId === agent.id && request.threadId === agent.threadId,
    );
  });
  const approval = createMemo(() =>
    workspace.state.approvals.find(
      (item) => item.agentId === workspace.state.selectedId && item.threadId === workspace.selected()?.threadId,
    ),
  );
  /** "Always allow", for an owner or admin whose host answered. The grant is written on the host. */
  const alwaysAllowApproval = createMemo(() => {
    const agent = workspace.selected();
    const item = approval();
    if (!agent || !item || !remoteAgentAdmin.settings()) return undefined;
    return async () => {
      await remoteAgentAdmin.update({ agentId: agent.id, autoApprove: true });
      if (approval()?.requestId !== item.requestId) return false;
      await workspace.approve({ requestId: item.requestId, decision: "accept" });
      return true;
    };
  });
  const setAgentAutoApprove = createMemo(() => {
    const agent = workspace.selected();
    if (!agent || !remoteAgentAdmin.settings()) return undefined;
    return (autoApprove: boolean) => remoteAgentAdmin.update({ agentId: agent.id, autoApprove });
  });
  const clearSelectedAgentContext = createMemo(() => {
    const agent = workspace.selected();
    if (!agent || !workspace.runtime.admin || !workspace.state.capabilities.includes(CONTEXT_RESET_CAPABILITY))
      return undefined;
    return () => clearAgentContext(hostRequest(), agent.id);
  });
  /**
   * As on desktop: an answered prompt stays until its bubble has shown the answers. After that, a
   * snapshot or page that the host made before it had the answer does not open the prompt again.
   */
  const [answeredPrompt, setAnsweredPrompt] = createSignal<{
    prompt: Extract<AgentEvent, { type: "prompt" }>;
    presented: boolean;
  }>();
  const isAnswered = (turnId: string, requestId: string | number) => {
    const answered = answeredPrompt()?.prompt;
    return answered?.turnId === turnId && String(answered.requestId) === String(requestId);
  };
  // The bubble unmounts with its conversation and then cannot report that it showed the answers.
  createEffect(
    () => ({ agentId: workspace.state.selectedId, hidden: creating() || channelOpen() }),
    () => setAnsweredPrompt(undefined),
  );
  const prompt = createMemo<Extract<AgentEvent, { type: "prompt" }> | undefined>(() => {
    if (workspace.state.status !== "online") return;
    const page = workspace.conversation()?.page;
    if (!page?.threadId) return;
    const pending = workspace.state.prompts.find(
      (item) =>
        item.agentId === page.agentId && item.threadId === page.threadId && !isAnswered(item.turnId, item.requestId),
    );
    if (pending) return pending;
    const answered = answeredPrompt();
    if (
      answered &&
      !answered.presented &&
      answered.prompt.agentId === page.agentId &&
      answered.prompt.threadId === page.threadId
    )
      return answered.prompt;
    const activeTurnId = page.activeTurnId;
    const message = page.messages.findLast(
      (item) =>
        item.turnId === activeTurnId &&
        item.questionPrompt &&
        !item.questionPrompt.resolution &&
        !(activeTurnId && isAnswered(activeTurnId, item.questionPrompt.requestId)),
    );
    if (!message?.questionPrompt || !page.activeTurnId) return;
    return {
      type: "prompt",
      agentId: page.agentId,
      threadId: page.threadId,
      turnId: page.activeTurnId,
      requestId: message.questionPrompt.requestId,
      questions: message.questionPrompt.questions,
    };
  });
  const messages = createMemo(() =>
    toAgentMessages(workspace.conversation()?.page?.messages ?? [], workspace.state.selectedId ?? undefined).map(
      withoutPreviewUrls,
    ),
  );
  /** The replied-to messages that are not on the loaded pages. The host sends them with each page. */
  const messageReferences = createMemo(() => {
    const page = workspace.conversation()?.page;
    if (!page) return {};
    return Object.fromEntries(
      Object.entries(page.references).map(([id, reference]) => [
        id,
        withoutPreviewUrls(toAgentMessage(reference, page.agentId)),
      ]),
    );
  });
  createEffect(
    () => workspace.state.error,
    (error) => {
      if (error) toast.error(sourceText(error));
    },
  );
  createEffect(
    () => ({ host: workspace.state.host?.hostId, state: workspace.state.status }),
    ({ host, state }) => {
      let active = true;
      usageGeneration += 1;
      setAccountUsage(null);
      setAnsweredPrompt(undefined);
      // A connect can load an empty host in the same update, so the first-agent form stays open.
      setCreating(untrack(() => firstAgent() && !channelOpen()));
      modelsShown = ++modelsRequest;
      setModels([]);
      setStatus(CONNECTING_STATUS);
      if (host && state === "online") {
        // Not through `workspace.run`: it drops a task while another runs, and the reconnect that
        // made the host online is still running here.
        const request = ++modelsRequest;
        void Promise.all([workspace.runtime.status(), workspace.runtime.models()]).then(
          ([nextStatus, nextModels]) => {
            if (!active) return;
            setStatus(nextStatus);
            showModels(request, nextModels);
          },
          (error: unknown) => {
            if (active) toast.error(error instanceof Error ? error.message : t("webClient.error.hostStatus"));
          },
        );
      }
      return () => {
        active = false;
      };
    },
  );
  async function refreshUsage(): Promise<AccountUsage> {
    const readUsage = workspace.runtime.accountUsage;
    if (!readUsage || workspace.state.status !== "online") throw new Error(t("webClient.error.usageOffline"));
    const generation = ++usageGeneration;
    const usage = await readUsage();
    if (generation === usageGeneration) setAccountUsage(usage);
    return usage;
  }
  async function select(id: string) {
    setCreating(false);
    setUsage(null);
    // A remounted conversation must not scroll again to a message that was picked before.
    setMessageFocusRequest(null);
    channels.close();
    await workspace.select(id);
  }
  async function openAddedAgent(agent: AddedAgent) {
    setMobilePane("conversation");
    await workspace.run(async () => {
      await workspace.refresh();
      await select(agent.id);
    });
  }
  function selectServer(id: string) {
    const host = workspace.state.hosts.find((item) => item.hostId === id);
    if (host) void workspace.connect(host);
  }
  function startCreate() {
    setMobilePane("conversation");
    channels.close();
    setUsage(null);
    setCreating(true);
  }
  /** Profile opens in the right panel of the agent on screen, so it needs that conversation. */
  const profileAgentId = () =>
    !agentFormOpen() && !channelOpen() && !noHost() && !hostOffline() ? (conversationAgent()?.id ?? null) : null;
  function openProfile() {
    const agentId = profileAgentId();
    if (!agentId) return;
    setMobilePane("conversation");
    setProfileRequest({ agentId, nonce: Date.now() });
  }
  const unavailable = async (): Promise<never> => {
    throw new Error(t("webClient.error.desktopOnly"));
  };
  return (
    <ConversationControllerProvider controller={controller}>
      <ChannelsControllerProvider controller={channels}>
        <WorkspaceFrame
          class="web-app-frame"
          data-web-mobile-pane={mobilePane()}
          compact={compact()}
          blockedServer={blockedServer()}
          onRetryServer={(serverId) =>
            workspace.run(async () => {
              const host = workspace.state.hosts.find((item) => item.hostId === serverId);
              if (host) await workspace.connect(host);
            })
          }
          usageOpen={usageOpen()}
          usage={
            <Show when={server()}>
              {(target) => (
                <AgentUsagePanel
                  port={usageCalls}
                  serverId={target().id}
                  hostName={target().name}
                  onBack={closeUsage}
                />
              )}
            </Show>
          }
          left={
            <>
              <Show when={layout.serverRailVisible()}>
                <ServerRail
                  servers={servers()}
                  onSelect={selectServer}
                  onReorder={workspace.reorderHosts}
                  onAdd={() => setJoinOpen(true)}
                  onOpenSettings={(id, trigger) => void openServerSettings(id, trigger)}
                  onOpenUsage={(id, trigger) => void openUsage(id, trigger)}
                />
              </Show>
              <Sidebar
                channels={channelsSupported() ? channels.state.channels.filter((channel) => !channel.archived) : []}
                deletedChannels={
                  channelsSupported() ? channels.state.channels.filter((channel) => channel.archived) : []
                }
                activeChannelId={channels.state.selectedId}
                onSelectChannel={(id) => {
                  setMobilePane("conversation");
                  void channels.open(id);
                }}
                onEditChannel={(id) => {
                  setMobilePane("conversation");
                  void channels.editChannel(id);
                }}
                onDeleteChannel={channels.deletionSupported() ? channels.remove : undefined}
                showingArchivedChannels={channels.state.archived}
                onToggleArchivedChannels={channelsSupported() ? channels.toggleArchived : undefined}
                onCreateChannel={channelsSupported() ? channels.create : undefined}
                onMarkAllRead={
                  workspace.state.status === "online"
                    ? () => {
                        void workspace.markAllRead().catch(() => toast.error(t("chat.unread.markReadFailed")));
                        if (channelsSupported()) void channels.markAllRead();
                      }
                    : undefined
                }
                // The browser client does not know the unread counts of agent chats it has not opened.
                hasUnread
                serverName={workspace.state.host?.name ?? "OpenBot"}
                serverMenu={{
                  servers: servers(),
                  view: layout.serverView(),
                  onViewChange: layout.setServerView,
                  onSelect: selectServer,
                  onAdd: () => setJoinOpen(true),
                  onOpenSettings: (id, trigger) => void openServerSettings(id, trigger),
                  onOpenUsage: (id, trigger) => void openUsage(id, trigger),
                }}
                agents={workspace.profiles()}
                activeAgentId={channelOpen() ? "" : (workspace.state.selectedId ?? "")}
                people={[]}
                directThreads={[]}
                activeDirectMemberId={null}
                agentStates={sidebarAgentStates()}
                agentMoods={sidebarAgentMoods()}
                layout={workspace.state.sidebarLayout}
                layoutMutable={
                  workspace.state.status === "online" && workspace.state.capabilities.includes("sidebar-layout")
                }
                collapsedSectionIds={workspace.preferences.collapsedSidebarSectionIds()}
                onMutateLayout={workspace.mutateSidebarLayout}
                onToggleSection={workspace.preferences.toggleSidebarSection}
                pinnedItems={workspace.preferences.pinnedSidebarItems()}
                peopleOrder={[]}
                onPin={workspace.preferences.pinSidebarItem}
                onUnpin={workspace.preferences.unpinSidebarItem}
                onReorderPinned={workspace.preferences.reorderPinnedSidebarItems}
                onReorderPeople={() => {}}
                onSelectAgent={(id) => {
                  setMobilePane("conversation");
                  void select(id);
                }}
                onSelectPerson={() => {}}
                onCreateAgent={startCreate}
                createSupported={createSupported()}
                onEditAgent={(id) => {
                  setMobilePane("conversation");
                  void select(id);
                  setSettingsRequest({ agentId: id, nonce: Date.now() });
                }}
                duplicateSupported={
                  workspace.state.status === "online" && workspace.state.capabilities.includes("agent-duplication")
                }
                duplicatingAgentIds={new Set(workspace.state.duplicatingAgentIds)}
                onDuplicateAgent={workspace.duplicateAgent}
                deleteSupported={
                  workspace.state.status === "online" &&
                  Boolean(workspace.state.host) &&
                  workspace.state.host?.role !== "member"
                }
                marketplaceSupported={workspace.state.status === "online"}
                onDeleteAgent={workspace.deleteAgent}
                compact={compact()}
                onExpand={layout.expandSidebar}
                onOpenMarketplace={() => setMarketplaceOpen(true)}
                emptyAction={
                  firstAgent()
                    ? {
                        label: t("sidebar.empty.firstAgent"),
                        avatarSeed: agentAvatar().avatarSeed,
                        avatarHue: agentAvatar().avatarHue,
                        onSelect: startCreate,
                      }
                    : undefined
                }
              />
              <AccountDock
                account={account()}
                // A browser has no app platform, but it draws the same shelf as the desktop app.
                appInfo={null}
                shelf
                agentStatus={status()}
                accountUsage={accountUsage()}
                usageProvider={workspace.selected()?.provider ?? null}
                usageModel={workspace.selected()?.model ?? null}
                usageTargetKey={usageTargetKey()}
                usageRefreshRevision={0}
                usageReady={usageReady()}
                updateStatus={{
                  phase: "unsupported",
                  currentVersion: "web",
                  availableVersion: null,
                  progress: null,
                  checkedAt: null,
                  message: null,
                  errorCode: null,
                }}
                compact={compact()}
                withServerRail={layout.serverRailVisible()}
                onRefreshUsage={refreshUsage}
                onUpdateAction={unavailable}
                onLogout={signOut}
                onOpenExternal={openWebDestination}
                onOpenProfile={profileAgentId() ? openProfile : undefined}
                onOpenSettings={
                  workspace.state.host
                    ? (trigger) => {
                        const host = workspace.state.host;
                        if (host) void openServerSettings(host.hostId, trigger);
                      }
                    : undefined
                }
                onOpenSkills={workspace.state.status === "online" ? () => setMarketplaceOpen(true) : undefined}
              />
              <WebMobileNavigation activePane={mobilePane()} onChange={setMobilePane} />
            </>
          }
          after={
            <>
              <JoinServerOverlay
                open={joinOpen()}
                inviteUrl={props.inviteUrl ?? ""}
                accountEmail={props.accountEmail ?? ""}
                onClose={() => {
                  setJoinOpen(false);
                  props.onInviteClose?.();
                }}
                onPreview={({ inviteUrl }) => workspace.runtime.previewInvite(inviteUrl)}
                onJoin={({ inviteUrl }) => workspace.joinInvite(inviteUrl)}
              />
              <MarketplaceOverlay
                open={marketplaceOpen()}
                onOpenChange={setMarketplaceOpen}
                calls={marketplaceCalls}
                server={server()}
                agents={workspace.state.agents}
                activeAgentId={workspace.state.selectedId ?? ""}
                composerAvailable={status().phase === "ready" && !agentFormOpen()}
                onOpenAgent={(agentId) => {
                  setMobilePane("conversation");
                  if (agentId !== workspace.state.selectedId) void select(agentId);
                  else {
                    // The agent is already loaded; only what covers its conversation closes.
                    setCreating(false);
                    setUsage(null);
                    channels.close();
                  }
                }}
                onAgentInstalled={async (agent) => {
                  setMarketplaceOpen(false);
                  await openAddedAgent(agent);
                }}
                pluginSlug={props.pluginSlug}
                onPluginSlugConsumed={() => props.onPluginSlugConsumed?.()}
              />
              <SharedAgentInstallOverlay
                templateId={props.agentTemplateId}
                server={server()}
                calls={agentTemplateCalls}
                onClose={() => props.onAgentTemplateClose?.()}
                onInstalled={openAddedAgent}
              />
              <Show when={serverSettings.state.open && server()}>
                {(target) => (
                  <ServerSettingsOverlay
                    open={serverSettings.state.open}
                    onOpenChange={serverSettings.setOpen}
                    restoreFocusTarget={serverSettings.restoreTarget()}
                    initialSection={serverSettingsSection()}
                    platform="darwin"
                    remoteDesktopSupported={false}
                    server={target()}
                    hostStatus={null}
                    members={serverSettings.state.members}
                    invites={serverSettings.state.invites}
                    loading={serverSettings.state.loading}
                    loadError={serverSettings.state.error}
                    onRetry={serverSettings.refresh}
                    onSaveIdentity={serverSettings.saveIdentity}
                    // Publication and screen recording belong to the computer that runs the server.
                    onSetPublished={unavailable}
                    onCreateInvite={serverSettings.createInvite}
                    onUpdateMember={serverSettings.updateMember}
                    onRemoveMember={serverSettings.removeMember}
                    onRevokeInvite={serverSettings.revokeInvite}
                    onOpenScreenRecordingSettings={unavailable}
                    onRecheckScreenRecording={unavailable}
                    mcpServers={serverSettings.state.mcp}
                    mcpLoadError={serverSettings.state.mcpError}
                    onMcpSectionShown={() => void serverSettings.refreshMcp()}
                    onRetryMcpServers={() => void serverSettings.refreshMcp()}
                    onSaveMcpServer={serverSettings.saveMcpServer}
                    onRemoveMcpServer={serverSettings.removeMcpServer}
                    onSetMcpServerEnabled={serverSettings.setMcpServerEnabled}
                    onTestMcpServer={serverSettings.testMcpServer}
                    storage={{
                      hostName: target().name,
                      calls: storageCalls,
                      onOpenAgent: (agentId) => {
                        serverSettings.setOpen(false);
                        setMobilePane("conversation");
                        void select(agentId);
                      },
                      onShowMessage: (agentId, messageId) => {
                        serverSettings.setOpen(false);
                        void openMessage(agentId, messageId);
                      },
                    }}
                    providers={providerSettings()}
                    hostUpdate={{ calls: hostUpdateCalls }}
                  />
                )}
              </Show>
              <ChannelCreateOverlay />
              <GlobalSearchOverlay
                open={searchOpen()}
                agents={workspace.profiles()}
                onSearchMessages={searchAllMessages}
                onOpenChange={setSearchOpen}
                onSelectAgent={(id) => {
                  setMobilePane("conversation");
                  void select(id);
                }}
                onSelectMessage={(agentId, messageId) => void openMessage(agentId, messageId)}
              />
            </>
          }
        >
          <Show when={agentFormOpen()}>
            <WebAgentSettings
              runtime={workspace.runtime}
              capabilities={workspace.state.capabilities}
              first={firstAgent()}
              customProviders={providerSettings()?.customProviders}
              // A new form starts empty, with the avatar that the first-agent row showed.
              initialDraft={{ ...createFirstAgentDraft(), ...untrack(agentAvatar) }}
              onDraftChange={({ avatarSeed, avatarHue }) => setAgentAvatar({ avatarSeed, avatarHue })}
              onClose={() => setCreating(false)}
              onSaved={async () => {
                await workspace.refresh();
                setAgentAvatar(newAgentAvatar());
                setCreating(false);
              }}
            />
          </Show>
          <Show when={!agentFormOpen() && channelOpen()}>
            <ChannelConversation
              isOwnMessage={(authorId) =>
                isOwnChannelAuthor(authorId, {
                  memberId: workspace.state.memberId,
                  accountUserId: props.accountId,
                  onOwnComputer: false,
                })
              }
              pendingApprovals={channelApprovals()}
              pendingTakeovers={channelTakeovers()}
              browserTabs={workspace.state.browserTabs}
              onSelectAgent={(id) => {
                setMobilePane("conversation");
                void select(id);
              }}
            />
          </Show>
          <Show when={!agentFormOpen() && !channelOpen() && noHost()}>
            <WebConnectComputer
              loading={workspace.state.hostsLoading}
              failed={Boolean(workspace.state.hostsError)}
              onJoin={() => setJoinOpen(true)}
              onRefresh={() => void workspace.run(workspace.refreshHosts)}
            />
          </Show>
          <Show when={!agentFormOpen() && !channelOpen() && hostOffline()}>
            <WebHostOffline
              title={
                workspace.state.host
                  ? workspace.state.status === "connecting"
                    ? t("webClient.notice.connecting")
                    : t("webClient.notice.disconnected")
                  : t("webClient.notice.findingHosts")
              }
              description={
                workspace.state.host
                  ? workspace.state.error
                    ? sourceText(workspace.state.error)
                    : t("webClient.notice.keepOpen")
                  : null
              }
              reconnectable={Boolean(workspace.state.host)}
              connecting={workspace.state.status === "connecting"}
              disabled={workspace.state.hostsLoading}
              onReconnect={() =>
                void workspace.run(async () => {
                  if (workspace.state.host) await workspace.connect(workspace.state.host);
                })
              }
            />
          </Show>
          <Show when={!agentFormOpen() && !channelOpen() && !noHost() && !hostOffline()}>
            <Conversation
              runtime={runtime}
              onOpenMarketplace={() => setMarketplaceOpen(true)}
              notice={
                <Show when={workspace.state.status === "online" && workspace.conversation()?.uncertain}>
                  <Alert class="web-connection-notice" tone="warning" role="status">
                    <AlertContent>
                      <AlertTitle>{t("webClient.uncertain.title")}</AlertTitle>
                      <AlertDescription>{t("webClient.uncertain.description")}</AlertDescription>
                      <AlertActions>
                        <Button
                          variant="outline"
                          size="sm"
                          disabled={workspace.state.busy}
                          onClick={() => void workspace.run(workspace.refresh)}
                        >
                          {t("webClient.uncertain.refresh")}
                        </Button>
                        <Button
                          variant="outline"
                          size="sm"
                          disabled={workspace.state.busy}
                          onClick={() => {
                            workspace.acknowledgeSend();
                            const key = `${server()?.id}:${workspace.state.selectedId}`;
                            controller.setComposerErrors((current) => {
                              const next = { ...current };
                              delete next[key];
                              return next;
                            });
                          }}
                        >
                          {t("webClient.uncertain.checked")}
                        </Button>
                      </AlertActions>
                    </AlertContent>
                  </Alert>
                </Show>
              }
              agentStatus={workspace.state.status === "online" ? status() : CONNECTING_STATUS}
              accountUsage={accountUsage()}
              // As in the desktop app on a joined host: an owner or admin downloads the host's
              // providers, and the sign-in stays in the host's settings.
              providerRuntimeStatuses={providerSettings()?.providerRuntimeStatuses}
              customProviders={providerSettings()?.customProviders}
              onDownloadProvider={providerSettings()?.onDownloadProvider}
              onCancelProviderDownload={providerSettings()?.onCancelProviderDownload}
              agent={conversationAgent()}
              agents={workspace.profiles()}
              modelOptions={models()}
              messages={messages()}
              messageReferences={messageReferences()}
              unreadCount={readState()?.unreadCount ?? 0}
              firstUnreadMessageId={readState()?.firstUnreadMessageId ?? null}
              loaded={Boolean(workspace.conversation()?.page)}
              hasOlder={workspace.conversation()?.page?.pageInfo.hasOlder}
              loadingOlder={workspace.conversation()?.loading}
              activeTurnId={workspace.conversation()?.page?.activeTurnId}
              activityDetail={
                workspace.state.selectedId ? workspace.state.progress[workspace.state.selectedId]?.detail : undefined
              }
              skillsMarketplaceOpen={marketplaceOpen()}
              mcpSettingsOpen={serverSettings.state.open || marketplaceOpen()}
              globalOverlayOpen={
                joinOpen() || serverSettings.state.open || searchOpen() || marketplaceOpen() || hasVisibleToasts()
              }
              settingsRequest={settingsRequest()}
              accountProfile={{
                account: account(),
                onUpdateAccountName: accountCalls.updateName,
                onUpdateAccountAvatar: accountCalls.updateAvatar,
                onListAccountSessions: accountCalls.listSessions,
                onRevokeAccountSession: accountCalls.revokeSession,
              }}
              profileRequest={profileRequest()}
              messageFocusRequest={messageFocusRequest()}
              queue={workspace.state.selectedId ? workspace.state.queues[workspace.state.selectedId] : undefined}
              browserRuntime={workspace.runtime.browser}
              browserTabs={workspace.state.browserTabs}
              activeBrowserTabId={workspace.state.activeBrowserTabId}
              browserVisibilitySuspended={workspace.state.status !== "online" || usageOpen()}
              workspaceCovered={usageOpen()}
              browserControlState={workspace.state.browserControlState}
              server={server()}
              presence={workspace.state.presence ?? { serverId: server()?.id ?? null, members: [], updatedAt: "" }}
              currentUserEmail={props.accountEmail ?? ""}
              browserEnabled={browserEnabled()}
              remoteDesktopEnabled={false}
              remoteDesktopSessionActive={false}
              remoteDesktopVisible={false}
              prompt={prompt()}
              approval={approval()}
              browserTakeover={browserTakeover()}
              onSelectAgent={(id) => {
                setMobilePane("conversation");
                void select(id);
              }}
              onUpdateAgent={async (agentId, updates) => {
                await updateRemoteAgent(remoteAgentAdmin, { agentId, ...updates }, workspace.runtime.updateAgent);
                await workspace.refresh();
              }}
              onSetAgentAvatar={async (agentId, image) => {
                await workspace.runtime.setAvatar(agentId, image);
                await workspace.refresh();
              }}
              onSendMessage={async (text, attachments, replyTo, target) => {
                const id = target?.agentId ?? workspace.state.selectedId;
                if (!id || (target && target.serverId !== server()?.id) || id !== workspace.state.selectedId)
                  return false;
                const sent = await workspace.send(text, attachments, replyTo);
                if (!sent)
                  controller.setComposerErrors((current) => ({
                    ...current,
                    [`${server()?.id}:${id}`]:
                      workspace.state.conversations[id]?.sendError ?? t("webClient.error.checkConversation"),
                  }));
                return sent;
              }}
              onMarkRead={workspace.markRead}
              onLoadOlder={() => void workspace.older()}
              onLoadLatest={workspace.refresh}
              onSearchMessages={async (query) => {
                const id = workspace.state.selectedId;
                if (!id) return { messageIds: [], total: 0 };
                const result = await workspace.runtime.search(id, query);
                return { messageIds: result.results.map((item) => item.message.id), total: result.total };
              }}
              onOpenSearchMessage={(messageId) => workspace.run(() => workspace.openSearchMessage(messageId))}
              onTypingChange={setTyping}
              onAnswerPrompt={async (answers) => {
                const question = prompt();
                if (!question) return false;
                setAnsweredPrompt({ prompt: question, presented: false });
                try {
                  await workspace.answer({ requestId: question.requestId, answers });
                } catch (error) {
                  setAnsweredPrompt(undefined);
                  throw error;
                }
                return true;
              }}
              onPromptResolutionPresented={(_agentId, turnId, requestId) => {
                const answered = answeredPrompt();
                if (answered && isAnswered(turnId, requestId)) setAnsweredPrompt({ ...answered, presented: true });
              }}
              onRespondToApproval={async (decision) => {
                const item = approval();
                if (!item) return false;
                await workspace.approve({ requestId: item.requestId, decision });
                return true;
              }}
              onAlwaysAllowApproval={alwaysAllowApproval()}
              agentAutoApproves={remoteAgentAdmin.settings()?.autoApprove ?? false}
              agentAutoApproveLocked={remoteAgentAdmin.settings()?.autoApproveLocked ?? false}
              onSetAgentAutoApprove={setAgentAutoApprove()}
              onClearAgentContext={clearSelectedAgentContext()}
              onRespondToBrowserTakeover={(decision) => workspace.respondToBrowserTakeover(decision)}
              onCancelQueuedMessage={workspace.cancelQueued}
              onSteerQueuedMessage={workspace.steerQueued}
              onUpdateQueuedMessage={workspace.updateQueued}
              onReorderQueue={workspace.reorderQueue}
              onActivateBrowserTab={workspace.activateBrowserTab}
              onCloseBrowserTab={(tabId) => workspace.runtime.closeBrowserTab(tabId)}
              onOpenRemoteDesktop={unavailable}
              onStop={() => {
                const page = workspace.conversation()?.page;
                if (page?.activeTurnId)
                  void workspace.run(() => workspace.runtime.stop(page.agentId, page.activeTurnId ?? ""));
              }}
            />
          </Show>
        </WorkspaceFrame>
      </ChannelsControllerProvider>
    </ConversationControllerProvider>
  );
}
