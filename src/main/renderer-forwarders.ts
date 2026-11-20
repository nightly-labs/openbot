import { hostname } from "node:os";
import { setTimeout as delay } from "node:timers/promises";
import {
  type AgentEvent,
  type AgentRuntimeSnapshot,
  agentNotificationLevelMap,
  type BrowserDisplayState,
  type ChannelSummary,
  type ChatWindowTarget,
  type ClientAgentSummary,
  decodeChannelSummaries,
  type HiddenAgentsSnapshot,
  IPC_ENDPOINTS,
  LOCAL_SERVER_ID,
  latestTurnAnswer,
  type ServerNotificationLevel,
  type SpeechModelStatus,
  type VoiceLiveEvent,
  type VoiceModelStatus,
  type VoiceServerSettings,
  type VoiceStreamTranscript,
} from "@openbot/contracts/ipc";
import { TEAM_API_ROUTES } from "@openbot/contracts/team-api-routes";
import { AGENT_HIDDEN_ROUTES } from "@openbot/contracts/team-protocol/agent-hidden-v1";
import { CHANNEL_ROUTES } from "@openbot/contracts/team-protocol/channels-v1";
import {
  AGENT_HIDDEN_WORK_CAPABILITY,
  TEAM_CHANNEL_ATTENTION_CAPABILITY,
} from "@openbot/contracts/team-protocol/current";
import type { MachineAlertEvent } from "@openbot/contracts/team-protocol/machine-resources-v1";
import type { AppFormat, AppTranslate } from "@openbot/i18n";
import { redactText } from "@openbot/logging";
import {
  type AgentNotificationChannel,
  agentEventAgentId,
  agentEventCanNotify,
  agentEventNeedsUser,
  agentEventRequestThread,
  notificationForAgentEvent,
  notificationForUsageLimit,
  notificationRequestKey,
  settledRequestKeys,
  teammateTurnCompleted,
} from "@openbot/team-client/agent-notifications";
import {
  channelForThread,
  channelReplyNotifications,
  newChannelReplies,
} from "@openbot/team-client/channel-notifications";
import { BrowserWindow, Notification } from "electron";
import { isNoUpdateAnswer } from "../backend/agent/routine-quiet-runs";
import type { AgentService } from "../backend/agent-service";
import { runCauseEffect } from "../backend/effect-boundary";
import type { WorkflowNotice } from "../backend/workflows/workflows";
import type { HostAnalytics } from "./analytics";
import {
  closeRetainedNotification,
  desktopAgentEventLevel,
  type NotificationChat,
  RETAINED_NOTIFICATION_LIMIT,
  showRetainedNotification,
} from "./desktop-notifications";
import type { HostService } from "./host-service";
import { withLocalHostSummary } from "./ipc/team-handlers";
import { decodeAgentSummaries, decodeHiddenAgentsFromHost } from "./remote-agent-decoding";
import type { RemoteServerManager } from "./remote-server-manager";
import { sendToRenderer } from "./renderer-ipc";

type NotifyLevel = (
  agentLevels: ReadonlyMap<string, ServerNotificationLevel> | null,
  hiddenAgentIds?: ReadonlySet<string> | null,
) => ServerNotificationLevel | null;

export interface RendererForwarderDependencies {
  getMainWindow: () => BrowserWindow | null;
  getChatWindows: () => BrowserWindow[];
  chatWindowTarget: (window: BrowserWindow) => ChatWindowTarget | null;
  getAgentService: () => Pick<AgentService, "listAgents" | "listHiddenAgents"> | null;
  getHostService: () => HostService | null;
  getHostAnalytics: () => HostAnalytics | null;
  getRemoteServerManager: () => Pick<
    RemoteServerManager,
    | "activeServerId"
    | "list"
    | "request"
    | "readAgentConversationPage"
    | "notificationLevels"
    | "cachedNotificationLevels"
    | "knownNotificationLevels"
    | "supportsCapability"
  > | null;
  ownAgentNotificationLevels: () => ReadonlyMap<string, ServerNotificationLevel>;
  showMainWindow: (window: BrowserWindow) => void;
  getTranslate: () => AppTranslate;
  getFormat: () => AppFormat;
  desktopNotificationsEnabled: () => boolean;
  notificationPreviewEnabled: () => boolean;
}

const ANSWER_LOOKUP_LIMIT = 20;
const WORKFLOW_NOTICE_LENGTH = 200;
const CHANNEL_READ_GAP_MS = 250;

export function createRendererForwarders({
  getMainWindow,
  getChatWindows,
  chatWindowTarget,
  getAgentService,
  getHostService,
  getHostAnalytics,
  getRemoteServerManager,
  showMainWindow,
  getTranslate,
  getFormat,
  desktopNotificationsEnabled,
  notificationPreviewEnabled,
  ownAgentNotificationLevels,
}: RendererForwarderDependencies) {
  function appWindows(): BrowserWindow[] {
    const window = getMainWindow();
    if (!window || window.isDestroyed()) return [];
    return [window, ...getChatWindows()];
  }

  function appFocused(window: BrowserWindow): boolean {
    return window.isFocused() || getChatWindows().some((chatWindow) => chatWindow.isFocused());
  }

  function windowShowsConversation(window: BrowserWindow, serverId: string, agentId: string | null): boolean {
    if (agentId === null) return true;
    const chat = chatWindowTarget(window);
    return chat === null || (chat.serverId === serverId && chat.agentId === agentId);
  }

  function forwardAgentEvent(serverId: string, event: AgentEvent, bufferedLive = false): void {
    if (serverId === LOCAL_SERVER_ID) getHostAnalytics()?.handleAgentEvent(event);
    const window = getMainWindow();
    if (!window || window.isDestroyed()) return;
    const scoped = bufferedLive ? { serverId, event, bufferedLive } : { serverId, event };
    const agentId = conversationAgentId(event);
    for (const target of appWindows()) {
      if (windowShowsConversation(target, serverId, agentId)) {
        sendToRenderer(target, IPC_ENDPOINTS.agent.scopedEvent, scoped);
      }
    }
    if (event.type === "browser-changed" && serverId !== LOCAL_SERVER_ID) {
      forwardBrowserDisplayState(serverId, { tabs: event.tabs, activeTabId: event.activeTabId });
    }
    void notifyAgentEvent(serverId, event).catch(() => undefined);
    if (event.type === "channels-changed") refreshChannels(serverId);
  }

  const channelLists = new Map<string, ChannelSummary[]>();
  const channelReads = new Map<string, boolean>();
  const channelNotifications = new Map<string, Notification>();
  const chatNotifications = new Map<string, Set<Notification>>();

  function chatKey(serverId: string, chat: NotificationChat): string {
    return "channelId" in chat ? `${serverId}\nchannel:${chat.channelId}` : `${serverId}\nagent:${chat.agentId}`;
  }

  function trackChatNotification(serverId: string, chat: NotificationChat, notification: Notification): void {
    const key = chatKey(serverId, chat);
    const shown = chatNotifications.get(key) ?? new Set<Notification>();
    chatNotifications.set(key, shown);
    shown.add(notification);
    for (const oldest of shown) {
      if (shown.size <= RETAINED_NOTIFICATION_LIMIT) break;
      shown.delete(oldest);
    }
    const release = () => {
      shown.delete(notification);
      if (shown.size === 0 && chatNotifications.get(key) === shown) chatNotifications.delete(key);
    };
    notification.on("click", release);
    notification.on("close", release);
    notification.on("failed", release);
  }

  function closeChatNotifications(serverId: string, chat: NotificationChat): void {
    const window = getMainWindow();
    if (!window || window.isDestroyed() || !appFocused(window)) return;
    const key = chatKey(serverId, chat);
    const shown = chatNotifications.get(key);
    if (!shown) return;
    chatNotifications.delete(key);
    for (const notification of shown) closeRetainedNotification(notification);
  }

  function replyLevel(serverId: string) {
    const server = getRemoteServerManager()
      ?.list()
      .find((candidate) => candidate.id === serverId);
    if (!desktopNotificationsEnabled() || !server || server.notificationsMuted) return null;
    return server.notificationLevel;
  }

  function refreshChannels(serverId: string): void {
    if (replyLevel(serverId) !== "all") {
      channelLists.delete(serverId);
      return;
    }
    if (channelReads.has(serverId)) {
      channelReads.set(serverId, true);
      return;
    }
    channelReads.set(serverId, false);
    void (async () => {
      do {
        channelReads.set(serverId, false);
        const startedAt = Date.now();
        const next = await readChannels(serverId);
        if (next) await notifyChannelReplies(serverId, next);
        const gap = CHANNEL_READ_GAP_MS - (Date.now() - startedAt);
        if (channelReads.get(serverId) && gap > 0) await delay(gap, undefined, { ref: false });
      } while (channelReads.get(serverId));
    })()
      .catch(() => undefined)
      .finally(() => channelReads.delete(serverId));
  }

  async function readChannels(serverId: string): Promise<ChannelSummary[] | null> {
    if (serverId === LOCAL_SERVER_ID) return getHostService()?.listChannels() ?? null;
    const remoteManager = getRemoteServerManager();
    const server = remoteManager?.list().find((candidate) => candidate.id === serverId);
    if (!remoteManager || !server?.compatibility?.capabilities.includes(TEAM_CHANNEL_ATTENTION_CAPABILITY)) return null;
    return runCauseEffect(remoteManager.request(serverId, CHANNEL_ROUTES.list, decodeChannelSummaries));
  }

  async function notifyChannelReplies(serverId: string, next: ChannelSummary[]): Promise<void> {
    const previous = channelLists.get(serverId) ?? null;
    channelLists.set(serverId, next);
    if (!previous || !Notification.isSupported()) return;
    const level = () => {
      const window = getMainWindow();
      if (!window || window.isDestroyed() || appFocused(window)) return null;
      return replyLevel(serverId);
    };
    if (level() !== "all" || newChannelReplies(previous, next).length === 0) return;
    const agentLookup = notificationAgents(serverId);
    const agents = agentLookup instanceof Promise ? await agentLookup : agentLookup;
    const current = level();
    if (!current) return;
    const replies = channelReplyNotifications(previous, next, {
      agents,
      translate: getTranslate(),
      level: current,
      redact: notificationPreviewEnabled() ? redactText : null,
    });
    for (const reply of replies) {
      const key = `${serverId}\n${reply.channelId}`;
      const notification = new Notification({ title: reply.title, body: reply.body });
      const shown = channelNotifications.get(key);
      if (shown) closeRetainedNotification(shown);
      channelNotifications.set(key, notification);
      const release = () => {
        if (channelNotifications.get(key) === notification) channelNotifications.delete(key);
      };
      notification.on("close", release);
      notification.on("failed", release);
      notification.on("click", () => {
        release();
        const window = getMainWindow();
        if (!window || window.isDestroyed()) return;
        showMainWindow(window);
        sendToRenderer(window, IPC_ENDPOINTS.notifications.opened, {
          serverId,
          agentId: reply.agentId,
          threadId: null,
          channelId: reply.channelId,
        });
      });
      trackChatNotification(serverId, { channelId: reply.channelId }, notification);
      showRetainedNotification(notification);
    }
  }

  function eventChannel(
    serverId: string,
    event: AgentEvent,
  ): AgentNotificationChannel | null | Promise<AgentNotificationChannel | null> {
    const threadId = agentEventRequestThread(event);
    if (threadId === null) return null;
    if (serverId === LOCAL_SERVER_ID) return getHostService()?.channelForThread(threadId) ?? null;
    const cached = channelForThread(channelLists.get(serverId) ?? [], threadId);
    if (cached) return cached;
    return readChannels(serverId)
      .catch(() => null)
      .then((channels) => (channels ? channelForThread(channels, threadId) : null));
  }

  const remoteAgents = new Map<string, ClientAgentSummary[]>();

  function notificationAgents(serverId: string): ClientAgentSummary[] | Promise<ClientAgentSummary[]> {
    if (serverId === LOCAL_SERVER_ID) return getAgentService()?.listAgents() ?? [];
    const remoteManager = getRemoteServerManager();
    if (!remoteManager) return [];
    return runCauseEffect(remoteManager.request(serverId, TEAM_API_ROUTES.agents.all, decodeAgentSummaries)).then(
      (agents) => {
        remoteAgents.set(serverId, agents);
        return agents;
      },
      () => remoteAgents.get(serverId) ?? [],
    );
  }

  function agentNotificationLevels(
    serverId: string,
  ): ReadonlyMap<string, ServerNotificationLevel> | Promise<ReadonlyMap<string, ServerNotificationLevel>> {
    if (serverId === LOCAL_SERVER_ID) return ownAgentNotificationLevels();
    const remoteManager = getRemoteServerManager();
    if (!remoteManager) return new Map();
    const known = remoteManager.knownNotificationLevels(serverId);
    if (known) return agentNotificationLevelMap(known);
    return runCauseEffect(remoteManager.notificationLevels(serverId)).then(agentNotificationLevelMap, () =>
      agentNotificationLevelMap(remoteManager.cachedNotificationLevels(serverId)),
    );
  }

  function userHiddenAgentIds(serverId: string): ReadonlySet<string> | Promise<ReadonlySet<string>> {
    const ids = (snapshot: HiddenAgentsSnapshot | undefined) =>
      new Set(snapshot?.agents.map((agent) => agent.agentId) ?? []);
    if (serverId === LOCAL_SERVER_ID) return ids(getAgentService()?.listHiddenAgents());
    const remoteManager = getRemoteServerManager();
    if (!remoteManager?.supportsCapability(serverId, AGENT_HIDDEN_WORK_CAPABILITY)) return ids(undefined);
    return runCauseEffect(
      remoteManager.request(serverId, AGENT_HIDDEN_ROUTES.read, decodeHiddenAgentsFromHost, {
        method: "POST",
        body: {},
      }),
    ).then(ids, () => ids(undefined));
  }

  const requestNotifications = new Map<string, Notification | null>();

  function withdrawRequestNotification(key: string): void {
    if (!requestNotifications.has(key)) return;
    const notification = requestNotifications.get(key);
    requestNotifications.delete(key);
    if (notification) closeRetainedNotification(notification);
  }

  function withdrawResolvedNotification(serverId: string, event: AgentEvent): void {
    if (event.type !== "agent-input-resolved" && event.type !== "browser-takeover-resolved") return;
    const key = notificationRequestKey(serverId, event);
    if (key) withdrawRequestNotification(key);
  }

  function withdrawSettledNotifications(serverId: string, snapshot: AgentRuntimeSnapshot): void {
    for (const key of settledRequestKeys(serverId, snapshot, requestNotifications.keys()))
      withdrawRequestNotification(key);
  }

  async function notifyAgentEvent(serverId: string, received: AgentEvent): Promise<void> {
    withdrawResolvedNotification(serverId, received);
    if (received.type === "thread-turn-completed" && !received.routine) return;
    if (teammateTurnCompleted(received)) return;
    const routineTaskId = received.type === "thread-turn-completed" ? received.taskId : null;
    const event = received.type === "thread-turn-completed" ? received.turn : received;
    if (!agentEventCanNotify(event) && event.type !== "usage-limit-reached" && event.type !== "subagent-failed") return;
    const notifyLevel: NotifyLevel = (agentLevels, hiddenAgentIds = null) => {
      const window = getMainWindow();
      const server = getRemoteServerManager()
        ?.list()
        .find((candidate) => candidate.id === serverId);
      if (!window || window.isDestroyed() || appFocused(window) || !server) return null;
      return desktopAgentEventLevel(event, server, desktopNotificationsEnabled(), agentLevels, hiddenAgentIds);
    };
    const agentId = event.type === "usage-limit-reached" ? null : agentEventAgentId(event);
    const mostOpen = agentId === null ? null : new Map([[agentId, "all" as const]]);
    if (!notifyLevel(mostOpen) || !Notification.isSupported()) return;
    const requestKey = notificationRequestKey(serverId, event);
    if (!requestKey) return showAgentNotification(serverId, event, notifyLevel, null, routineTaskId);
    if (!requestNotifications.has(requestKey)) requestNotifications.set(requestKey, null);
    try {
      await showAgentNotification(serverId, event, notifyLevel, requestKey, null);
    } finally {
      if (requestNotifications.get(requestKey) === null) requestNotifications.delete(requestKey);
    }
  }

  async function showAgentNotification(
    serverId: string,
    event: AgentEvent,
    notifyLevel: NotifyLevel,
    requestKey: string | null,
    routineTaskId: string | null,
  ): Promise<void> {
    const preview = notificationPreviewEnabled();
    const answer =
      preview && event.type === "turn-completed" && event.status === "completed"
        ? routineTaskId
          ? routineTurnAnswer(event.agentId, routineTaskId, event.turnId)
          : turnAnswer(serverId, event.agentId, event.turnId)
        : null;
    const agentLookup = notificationAgents(serverId);
    const agents = agentLookup instanceof Promise ? await agentLookup : agentLookup;
    const reply = answer ? await answer : null;
    const lookup = eventChannel(serverId, event);
    const channel = lookup instanceof Promise ? await lookup : lookup;
    const levelLookup = agentNotificationLevels(serverId);
    const levels = levelLookup instanceof Promise ? await levelLookup : levelLookup;
    const open = notifyLevel(levels);
    const hiddenLookup =
      open === "all" && event.type !== "usage-limit-reached" && !agentEventNeedsUser(event)
        ? userHiddenAgentIds(serverId)
        : null;
    const level =
      hiddenLookup === null
        ? open
        : notifyLevel(levels, hiddenLookup instanceof Promise ? await hiddenLookup : hiddenLookup);
    const content = !level
      ? null
      : event.type === "usage-limit-reached"
        ? notificationForUsageLimit(event, agents, getTranslate(), getFormat(), level)
        : notificationForAgentEvent(
            event,
            agents,
            getTranslate(),
            level,
            preview && notificationPreviewEnabled() ? { reply, redact: redactText } : null,
            channel,
          );
    if (!content || (requestKey && !requestNotifications.has(requestKey))) return;
    const notification = new Notification({ title: content.title, body: content.body });
    if (requestKey) {
      const previous = requestNotifications.get(requestKey);
      if (previous) closeRetainedNotification(previous);
      requestNotifications.set(requestKey, notification);
      for (const oldest of requestNotifications.keys()) {
        if (requestNotifications.size <= RETAINED_NOTIFICATION_LIMIT) break;
        requestNotifications.delete(oldest);
      }
      const release = () => {
        if (requestNotifications.get(requestKey) === notification) requestNotifications.delete(requestKey);
      };
      notification.on("click", release);
      notification.on("close", release);
      notification.on("failed", release);
    }
    notification.on("click", () => {
      const current = getMainWindow();
      if (!current || current.isDestroyed()) return;
      showMainWindow(current);
      sendToRenderer(current, IPC_ENDPOINTS.notifications.opened, {
        serverId,
        agentId: content.agentId,
        threadId: content.threadId,
        ...(content.channelId ? { channelId: content.channelId } : {}),
      });
    });
    const ownThreadId = agents.find((agent) => agent.id === content.agentId)?.threadId ?? null;
    if (content.channelId) trackChatNotification(serverId, { channelId: content.channelId }, notification);
    else if (!routineTaskId && (ownThreadId === null || ownThreadId === content.threadId))
      trackChatNotification(serverId, { agentId: content.agentId }, notification);
    showRetainedNotification(notification);
  }

  async function turnAnswer(serverId: string, agentId: string, turnId: string): Promise<string | null> {
    const page =
      serverId === LOCAL_SERVER_ID
        ? getHostService()?.readAgentConversationPage(agentId, { type: "latest" }, ANSWER_LOOKUP_LIMIT)
        : getRemoteServerManager()?.readAgentConversationPage(
            agentId,
            { type: "latest" },
            ANSWER_LOOKUP_LIMIT,
            serverId,
          );
    if (!page) return null;
    const loaded = await runCauseEffect(page).catch(() => null);
    const answer = loaded && latestTurnAnswer(loaded.messages, turnId)?.text;
    return answer && !isNoUpdateAnswer(answer) ? answer : null;
  }

  function routineTurnAnswer(agentId: string, taskId: string, turnId: string): string | null {
    try {
      const snapshot = getHostService()?.readAgentTask(agentId, taskId);
      const answer = snapshot && latestTurnAnswer(snapshot.messages, turnId)?.text;
      return answer && !isNoUpdateAnswer(answer) ? answer : null;
    } catch {
      return null;
    }
  }

  function forwardWorkflowNotice(notice: WorkflowNotice): void {
    if (!desktopNotificationsEnabled()) return;
    const translate = getTranslate();
    const preview = notificationPreviewEnabled() ? redactText(notice.text).trim() : "";
    const fallback =
      notice.kind === "approval"
        ? translate("notification.workflowApproval")
        : translate("notification.workflowOutput");
    const body =
      preview.length > WORKFLOW_NOTICE_LENGTH
        ? `${preview.slice(0, WORKFLOW_NOTICE_LENGTH - 1)}…`
        : preview || fallback;
    const notification = new Notification({ title: notice.workflowTitle, body });
    notification.on("click", () => {
      const current = getMainWindow();
      if (!current || current.isDestroyed()) return;
      showMainWindow(current);
      sendToRenderer(current, IPC_ENDPOINTS.notifications.workflowOpened, {
        serverId: LOCAL_SERVER_ID,
        workflowId: notice.workflowId,
      });
    });
    showRetainedNotification(notification);
  }

  const shownMachineAlerts = new Set<string>();

  function forwardMachineAlert(serverId: string, event: MachineAlertEvent): void {
    const key = `${serverId}\n${event.alertId}`;
    if (shownMachineAlerts.has(key)) return;
    shownMachineAlerts.add(key);
    for (const oldest of shownMachineAlerts) {
      if (shownMachineAlerts.size <= RETAINED_NOTIFICATION_LIMIT) break;
      shownMachineAlerts.delete(oldest);
    }
    if (!desktopNotificationsEnabled() || !Notification.isSupported()) return;
    const remote = getRemoteServerManager()
      ?.list()
      .find((server) => server.id === serverId);
    if (remote?.notificationsMuted || remote?.notificationLevel === "nothing") return;
    const name =
      serverId === LOCAL_SERVER_ID
        ? (getHostService()?.getStatus().serverName ?? remote?.name ?? hostname())
        : remote?.name;
    if (!name) return;
    const translate = getTranslate();
    const { percent } = getFormat();
    const params = { server: name, percent: percent(event.percent / 100), level: percent(event.level / 100) };
    const title =
      event.metric === "disk"
        ? translate("notification.machineAlert.disk", params)
        : event.metric === "memory"
          ? translate("notification.machineAlert.memory", params)
          : translate("notification.machineAlert.cpu", params);
    const notification = new Notification({ title, body: translate("notification.machineAlert.body", params) });
    notification.on("click", () => {
      const current = getMainWindow();
      if (current && !current.isDestroyed()) showMainWindow(current);
    });
    showRetainedNotification(notification);
  }

  function forwardBrowserDisplayState(serverId: string, state: BrowserDisplayState): void {
    if (serverId !== (getRemoteServerManager()?.activeServerId ?? LOCAL_SERVER_ID)) return;
    for (const window of BrowserWindow.getAllWindows()) {
      sendToRenderer(window, IPC_ENDPOINTS.browser.displayState, state);
    }
  }

  function forwardUpdateStatus(status: import("@openbot/contracts/ipc").UpdateStatus): void {
    for (const window of appWindows()) sendToRenderer(window, IPC_ENDPOINTS.update.event, status);
  }

  function forwardUpdatePreference(preference: import("@openbot/contracts/ipc").UpdatePreference): void {
    for (const window of appWindows()) sendToRenderer(window, IPC_ENDPOINTS.update.preference, preference);
  }

  function forwardVoiceModelStatus(status: VoiceModelStatus): void {
    for (const window of appWindows()) sendToRenderer(window, IPC_ENDPOINTS.voice.modelStatus, status);
  }

  function forwardSpeechModelStatus(status: SpeechModelStatus): void {
    for (const window of appWindows()) sendToRenderer(window, IPC_ENDPOINTS.voice.speechModelStatus, status);
  }

  function forwardVoiceServerSettings(settings: VoiceServerSettings | null): void {
    for (const window of appWindows()) sendToRenderer(window, IPC_ENDPOINTS.voice.serverSettings, settings);
  }

  function forwardVoiceStreamTranscript(transcript: VoiceStreamTranscript): void {
    for (const window of appWindows()) sendToRenderer(window, IPC_ENDPOINTS.voice.streamTranscript, transcript);
  }

  function forwardVoiceLiveEvent(event: VoiceLiveEvent, memberId: string | null = null): void {
    if (memberId !== null) return;
    for (const window of appWindows()) sendToRenderer(window, IPC_ENDPOINTS.voice.liveEvent, event);
  }

  function forwardProviderRuntimeStatus(snapshot: import("@openbot/contracts/ipc").ProviderRuntimeSnapshot): void {
    for (const window of appWindows()) sendToRenderer(window, IPC_ENDPOINTS.providerRuntimes.event, snapshot);
  }

  function forwardGitHubConnectorStatus(status: import("@openbot/contracts/ipc").GitHubConnectorStatus): void {
    for (const window of appWindows()) sendToRenderer(window, IPC_ENDPOINTS.githubConnector.changed, status);
  }

  function forwardLinkAccountStatus(status: import("@openbot/contracts/ipc").LinkAccountStatus): void {
    for (const window of appWindows()) sendToRenderer(window, IPC_ENDPOINTS.linkAccount.changed, status);
  }

  function forwardOnePasswordConnectorStatus(
    status: import("@openbot/contracts/ipc").OnePasswordConnectorStatus,
  ): void {
    for (const window of appWindows()) sendToRenderer(window, IPC_ENDPOINTS.onePasswordConnector.changed, status);
  }

  function forwardBitwardenConnectorStatus(status: import("@openbot/contracts/ipc").BitwardenConnectorStatus): void {
    for (const window of appWindows()) sendToRenderer(window, IPC_ENDPOINTS.bitwardenConnector.changed, status);
  }
  function forwardPasswordManagerStatus(status: import("@openbot/contracts/ipc").PasswordManagerStatus): void {
    for (const window of appWindows()) sendToRenderer(window, IPC_ENDPOINTS.passwordManagers.changed, status);
  }

  function forwardVaultState(state: import("@openbot/contracts/ipc").VaultState): void {
    for (const window of appWindows()) sendToRenderer(window, IPC_ENDPOINTS.vault.changed, state);
  }

  function forwardHostStatus(status: import("@openbot/contracts/ipc").HostStatus): void {
    const remoteServers = getRemoteServerManager();
    const servers = remoteServers ? withLocalHostSummary(remoteServers.list(), status) : null;
    for (const target of appWindows()) {
      sendToRenderer(target, IPC_ENDPOINTS.host.event, status);
      if (servers) sendToRenderer(target, IPC_ENDPOINTS.servers.event, servers);
    }
  }

  function forwardRemoteDesktopSessions(sessions: import("@openbot/contracts/ipc").RemoteDesktopSession[]): void {
    const window = getMainWindow();
    if (!window || window.isDestroyed()) return;
    sendToRenderer(window, IPC_ENDPOINTS.remoteDesktop.event, sessions);
  }

  function forwardServers(servers: import("@openbot/contracts/ipc").ServerSummary[]): void {
    const host = getHostService();
    const summaries = host ? withLocalHostSummary(servers, host.getStatus()) : servers;
    for (const target of appWindows()) sendToRenderer(target, IPC_ENDPOINTS.servers.event, summaries);
  }

  function forwardTeamPresence(
    serverId: string,
    snapshot: import("@openbot/contracts/ipc").TeamPresenceSnapshot,
  ): void {
    for (const target of appWindows()) {
      sendToRenderer(target, IPC_ENDPOINTS.servers.scopedPresence, { serverId, snapshot });
    }
  }

  function forwardDirectMessage(
    serverId: string,
    event: import("@openbot/contracts/ipc").DirectMessageRealtimeEvent,
  ): void {
    const window = getMainWindow();
    if (!window || window.isDestroyed()) return;
    sendToRenderer(window, IPC_ENDPOINTS.servers.scopedDirectMessage, { serverId, event });
  }

  function forwardDirectTyping(
    serverId: string,
    event: import("@openbot/contracts/ipc").DirectTypingRealtimeEvent,
  ): void {
    const window = getMainWindow();
    if (!window || window.isDestroyed()) return;
    sendToRenderer(window, IPC_ENDPOINTS.servers.scopedDirectTyping, { serverId, event });
  }

  function forwardAttachmentDownload(progress: import("@openbot/contracts/ipc").AttachmentDownloadProgress): void {
    for (const target of appWindows())
      sendToRenderer(target, IPC_ENDPOINTS.agentAttachments.attachmentDownload, progress);
  }

  function forwardAttachmentImportProgress(progress: import("@openbot/contracts/ipc").AttachmentImportProgress): void {
    for (const target of appWindows()) sendToRenderer(target, IPC_ENDPOINTS.attachmentImports.importProgress, progress);
  }

  function forwardInstanceTransferUploadProgress(
    progress: import("@openbot/contracts/ipc").InstanceTransferUploadProgress,
  ): void {
    for (const target of appWindows()) sendToRenderer(target, IPC_ENDPOINTS.instanceTransfer.uploadProgress, progress);
  }

  return {
    closeChatNotifications,
    forwardAgentEvent,
    withdrawSettledNotifications,
    forwardWorkflowNotice,
    forwardMachineAlert,
    forwardBrowserDisplayState,
    forwardUpdateStatus,
    forwardUpdatePreference,
    forwardVoiceModelStatus,
    forwardVoiceStreamTranscript,
    forwardVoiceLiveEvent,
    forwardSpeechModelStatus,
    forwardVoiceServerSettings,
    forwardProviderRuntimeStatus,
    forwardGitHubConnectorStatus,
    forwardLinkAccountStatus,
    forwardOnePasswordConnectorStatus,
    forwardBitwardenConnectorStatus,
    forwardPasswordManagerStatus,
    forwardVaultState,
    forwardHostStatus,
    forwardRemoteDesktopSessions,
    forwardServers,
    forwardTeamPresence,
    forwardDirectMessage,
    forwardDirectTyping,
    forwardAttachmentDownload,
    forwardAttachmentImportProgress,
    forwardInstanceTransferUploadProgress,
  };
}

function conversationAgentId(event: AgentEvent): string | null {
  switch (event.type) {
    case "conversation-delta":
    case "turn-progress":
      return event.agentId;
    case "conversation":
      return event.snapshot.agentId;
    case "conversation-page":
      return event.page.agentId;
    default:
      return null;
  }
}
