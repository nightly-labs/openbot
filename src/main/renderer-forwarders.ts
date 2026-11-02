/**
 * The service events the main process relays to the renderer. They live here rather than in
 * the entry point because every one of them is the same three lines around a different channel, and
 * because they are the part of the entry point most likely to be edited by two agents at once.
 *
 * Every dependency is a **function**, never a nullable value. These are built at module scope, before
 * `app.whenReady()` has constructed anything, so `getHostService()` and `hostService` behave
 * differently at run time - and `() => HostService | null` and `HostService | null` both type-check
 * at every call site, so `tsc` cannot tell you which one you passed. A function-typed field makes
 * the wrong one an error. Each of them now reads one `ApplicationServices` handle rather than its
 * own module-scope `let`.
 *
 * `showMainWindow` is injected rather than imported so that this module stays reachable from a test
 * without pulling in `main-window.ts` and, through it, the whole window and menu surface.
 */

import { hostname } from "node:os";
import {
  type AgentEvent,
  agentNotificationLevelMap,
  type BrowserDisplayState,
  type ChannelSummary,
  type ClientAgentSummary,
  decodeChannelSummaries,
  IPC_ENDPOINTS,
  LOCAL_SERVER_ID,
  latestTurnAnswer,
  type ServerNotificationLevel,
  type SpeechModelStatus,
  type VoiceModelStatus,
  type VoiceServerSettings,
  type VoiceStreamTranscript,
} from "@openbot/contracts/ipc";
import { TEAM_API_ROUTES } from "@openbot/contracts/team-api-routes";
import { CHANNEL_ROUTES } from "@openbot/contracts/team-protocol/channels-v1";
import { TEAM_CHANNEL_ATTENTION_CAPABILITY } from "@openbot/contracts/team-protocol/current";
import type { MachineAlertEvent } from "@openbot/contracts/team-protocol/machine-resources-v1";
import type { AppFormat, AppTranslate } from "@openbot/i18n";
import { redactText } from "@openbot/logging";
import {
  type AgentNotificationChannel,
  agentEventAgentId,
  agentEventCanNotify,
  agentEventRequestThread,
  notificationForAgentEvent,
  notificationForUsageLimit,
  notificationRequestKey,
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
  RETAINED_NOTIFICATION_LIMIT,
  showRetainedNotification,
} from "./desktop-notifications";
import type { HostService } from "./host-service";
import { withLocalHostSummary } from "./ipc/team-handlers";
import { decodeAgentSummaries } from "./remote-agent-decoding";
import type { RemoteServerManager } from "./remote-server-manager";
import { sendToRenderer } from "./renderer-ipc";

export interface RendererForwarderDependencies {
  getMainWindow: () => BrowserWindow | null;
  /** Each chat window shows a live chat, so it gets the chat, server and provider events too. */
  getChatWindows: () => BrowserWindow[];
  getAgentService: () => Pick<AgentService, "listAgents"> | null;
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
  > | null;
  /** The level that the user chose for each agent of this computer's server. */
  ownAgentNotificationLevels: () => ReadonlyMap<string, ServerNotificationLevel>;
  showMainWindow: (window: BrowserWindow) => void;
  /** The language every desktop notification is written in, read at the moment one is raised. */
  getTranslate: () => AppTranslate;
  /** The dates and numbers of a desktop notification, in the same language. */
  getFormat: () => AppFormat;
  /** The Settings switch for every desktop notification, read at the moment one is raised. */
  desktopNotificationsEnabled: () => boolean;
  /** The Settings switch that lets a notification show the agent's words. */
  notificationPreviewEnabled: () => boolean;
}

/** The newest messages that a finished turn's answer is looked for in. */
const ANSWER_LOOKUP_LIMIT = 20;
/** The longest workflow text a notification shows. */
const WORKFLOW_NOTICE_LENGTH = 200;

/**
 * Returns the forwarders as an object so the entry point can destructure it and keep every
 * `service.on("event", forwardX)` registration exactly as it was.
 */
export function createRendererForwarders({
  getMainWindow,
  getChatWindows,
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
  // The user looks at the app when the main window or one of its chat windows has focus.
  /** The main window and each chat window (#2964). A chat window does not outlive the main window. */
  function appWindows(): BrowserWindow[] {
    const window = getMainWindow();
    if (!window || window.isDestroyed()) return [];
    return [window, ...getChatWindows()];
  }

  function appFocused(window: BrowserWindow): boolean {
    return window.isFocused() || getChatWindows().some((chatWindow) => chatWindow.isFocused());
  }

  function forwardAgentEvent(serverId: string, event: AgentEvent, bufferedLive = false): void {
    if (serverId === LOCAL_SERVER_ID) getHostAnalytics()?.handleAgentEvent(event);
    const window = getMainWindow();
    if (!window || window.isDestroyed()) return;
    const scoped = bufferedLive ? { serverId, event, bufferedLive } : { serverId, event };
    for (const target of appWindows()) sendToRenderer(target, IPC_ENDPOINTS.agent.scopedEvent, scoped);
    // The local browser sends its own display state.
    if (event.type === "browser-changed" && serverId !== LOCAL_SERVER_ID) {
      forwardBrowserDisplayState(serverId, { tabs: event.tabs, activeTabId: event.activeTabId });
    }
    // Once for the app, not once for each window.
    void notifyAgentEvent(serverId, event).catch(() => undefined);
    if (event.type === "channels-changed") refreshChannels(serverId);
  }

  /**
   * The newest channel list of each server. It is the baseline of the next channel reply
   * notification, and it maps a remote prompt's thread to its channel. The list is read again on
   * each `channels-changed`, also while the window has focus, so the baseline stays current. The
   * first list of a server only sets the baseline. A reply streams before it completes, so its first
   * change sets the baseline and its completion notifies.
   */
  const channelLists = new Map<string, ChannelSummary[]>();
  /** The servers whose channel list is being read. True when a change came in during the read. */
  const channelReads = new Map<string, boolean>();
  /** The shown reply notification of each channel. A newer reply replaces it. */
  const channelNotifications = new Map<string, Notification>();

  /** The notification level of a server's channel replies, or null when none can show. */
  function replyLevel(serverId: string) {
    const server = getRemoteServerManager()
      ?.list()
      .find((candidate) => candidate.id === serverId);
    if (!desktopNotificationsEnabled() || !server || server.notificationsMuted) return null;
    return server.notificationLevel;
  }

  /**
   * One read at a time for each server. A change during a read causes one more read after it. A
   * streaming reply changes the channels on each frame, so a server whose replies cannot notify is
   * not read: its baseline is dropped, and the next list sets a new one. A prompt reads its channel
   * on its own when the list has none.
   */
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
        const next = await readChannels(serverId);
        if (next) await notifyChannelReplies(serverId, next);
      } while (channelReads.get(serverId));
    })()
      .catch(() => undefined)
      .finally(() => channelReads.delete(serverId));
  }

  /**
   * The channel list of a server, or null when it has none to read. A remote host without
   * channel-attention-v1 sends no author, status or threads, so its list cannot notify.
   */
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
    // Only "all" notifies a reply. The agent lookup is skipped at the other levels, and while a
    // reply streams, when no reply is new.
    if (level() !== "all" || newChannelReplies(previous, next).length === 0) return;
    const agentLookup = notificationAgents(serverId);
    const agents = agentLookup instanceof Promise ? await agentLookup : agentLookup;
    // The settings are read again: the user can change them while the lookup runs.
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
      showRetainedNotification(notification);
    }
  }

  /**
   * The channel of a prompt, an approval or a takeover, or null when its thread is no channel's. A
   * known channel comes back at once, so a local notification still shows before
   * `forwardAgentEvent` returns. Only a remote thread that is not in the list waits for a read.
   */
  function eventChannel(
    serverId: string,
    event: AgentEvent,
  ): AgentNotificationChannel | null | Promise<AgentNotificationChannel | null> {
    const threadId = agentEventRequestThread(event);
    if (threadId === null) return null;
    if (serverId === LOCAL_SERVER_ID) return getHostService()?.channelForThread(threadId) ?? null;
    const cached = channelForThread(channelLists.get(serverId) ?? [], threadId);
    if (cached) return cached;
    // A new channel, or a member that joined after the last list: its thread is not in the list yet.
    return readChannels(serverId)
      .catch(() => null)
      .then((channels) => (channels ? channelForThread(channels, threadId) : null));
  }

  /**
   * The last agent list that each remote server gave. The request can fail just after the event came,
   * as when the connection drops, and the notification then names the agents of this list.
   */
  const remoteAgents = new Map<string, ClientAgentSummary[]>();

  /** The agents of a server. The local list comes at once, so a local notification shows before the event returns. */
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

  /**
   * The level that the user chose for each agent of a server. The local levels come at once. The
   * manager keeps the levels of a remote server current from its connection and its events, so only
   * a server whose levels this computer could not read yet gets a request, as when the read at
   * connection failed.
   */
  function agentNotificationLevels(
    serverId: string,
  ): ReadonlyMap<string, ServerNotificationLevel> | Promise<ReadonlyMap<string, ServerNotificationLevel>> {
    if (serverId === LOCAL_SERVER_ID) return ownAgentNotificationLevels();
    const remoteManager = getRemoteServerManager();
    if (!remoteManager) return new Map();
    const known = remoteManager.knownNotificationLevels(serverId);
    if (known) return agentNotificationLevelMap(known);
    // The read also refreshes the server level in the server list, which `notifyLevel` reads after it.
    return runCauseEffect(remoteManager.notificationLevels(serverId)).then(agentNotificationLevelMap, () =>
      agentNotificationLevelMap(remoteManager.cachedNotificationLevels(serverId)),
    );
  }

  /**
   * The notifications that wait for an answer, by request. An answer on any device withdraws its
   * notification. A request whose notification is still being built has no notification yet, and an
   * answer that arrives then removes the entry, so the notification is not shown.
   */
  const requestNotifications = new Map<string, Notification | null>();

  function withdrawResolvedNotification(serverId: string, event: AgentEvent): void {
    if (event.type !== "agent-input-resolved" && event.type !== "browser-takeover-resolved") return;
    const key = notificationRequestKey(serverId, event);
    if (!key || !requestNotifications.has(key)) return;
    const notification = requestNotifications.get(key);
    requestNotifications.delete(key);
    if (notification) closeRetainedNotification(notification);
  }

  async function notifyAgentEvent(serverId: string, event: AgentEvent): Promise<void> {
    withdrawResolvedNotification(serverId, event);
    // Most events stream while an agent works. Only these can notify, so the others skip the server list.
    if (!agentEventCanNotify(event) && event.type !== "usage-limit-reached") return;
    // Like Discord, nothing pops up while the user is looking at the app. The level is read again
    // after the lookup, with the rest, because the user can change it while the lookup runs.
    const notifyLevel = (agentLevels: ReadonlyMap<string, ServerNotificationLevel> | null) => {
      const window = getMainWindow();
      const server = getRemoteServerManager()
        ?.list()
        .find((candidate) => candidate.id === serverId);
      if (!window || window.isDestroyed() || appFocused(window) || !server) return null;
      return desktopAgentEventLevel(event, server, desktopNotificationsEnabled(), agentLevels);
    };
    // The level also rules out an event before the remote lookups. The level of an agent can let more
    // through than the server level, so this first check uses the most open one.
    const agentId = event.type === "usage-limit-reached" ? null : agentEventAgentId(event);
    const mostOpen = agentId === null ? null : new Map([[agentId, "all" as const]]);
    if (!notifyLevel(mostOpen) || !Notification.isSupported()) return;
    const requestKey = notificationRequestKey(serverId, event);
    if (!requestKey) return showAgentNotification(serverId, event, notifyLevel, null);
    // A shown notification of the same request stays until the new one replaces it.
    if (!requestNotifications.has(requestKey)) requestNotifications.set(requestKey, null);
    try {
      await showAgentNotification(serverId, event, notifyLevel, requestKey);
    } finally {
      // Nothing was shown, or the lookup failed.
      if (requestNotifications.get(requestKey) === null) requestNotifications.delete(requestKey);
    }
  }

  async function showAgentNotification(
    serverId: string,
    event: AgentEvent,
    notifyLevel: (agentLevels: ReadonlyMap<string, ServerNotificationLevel> | null) => ServerNotificationLevel | null,
    requestKey: string | null,
  ): Promise<void> {
    const preview = notificationPreviewEnabled();
    const answer =
      preview && event.type === "turn-completed" && event.status === "completed"
        ? turnAnswer(serverId, event.agentId, event.turnId)
        : null;
    const agentLookup = notificationAgents(serverId);
    const agents = agentLookup instanceof Promise ? await agentLookup : agentLookup;
    const reply = answer ? await answer : null;
    const lookup = eventChannel(serverId, event);
    const channel = lookup instanceof Promise ? await lookup : lookup;
    const levelLookup = agentNotificationLevels(serverId);
    const level = notifyLevel(levelLookup instanceof Promise ? await levelLookup : levelLookup);
    const content = !level
      ? null
      : event.type === "usage-limit-reached"
        ? notificationForUsageLimit(event, agents, getTranslate(), getFormat(), level)
        : notificationForAgentEvent(
            event,
            agents,
            getTranslate(),
            level,
            // The switch is read again: the user can turn it off while the lookups run.
            preview && notificationPreviewEnabled() ? { reply, redact: redactText } : null,
            channel,
          );
    // An answer from another device came in while the lookups ran.
    if (!content || (requestKey && !requestNotifications.has(requestKey))) return;
    const notification = new Notification({ title: content.title, body: content.body });
    if (requestKey) {
      // A provider can use a request id again, and a host can send a request again after a reconnect.
      // The newest notification replaces the one before it.
      const previous = requestNotifications.get(requestKey);
      if (previous) closeRetainedNotification(previous);
      requestNotifications.set(requestKey, notification);
      // A lost connection can drop the answer of a remote request, so the oldest entries go.
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
      // Re-read the window because it can change after the notification is shown.
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
    showRetainedNotification(notification);
  }

  /** The text of a finished turn's answer, or null when it cannot be read. The notification then shows a fixed text. */
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
    // A routine Test run shows the no-update marker in the chat, but it is not news to show.
    return answer && !isNoUpdateAnswer(answer) ? answer : null;
  }

  /** A workflow step that waits for the user, or a workflow output. A click shows the main window. */
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
      if (current && !current.isDestroyed()) showMainWindow(current);
    });
    showRetainedNotification(notification);
  }

  const shownMachineAlerts = new Set<string>();

  /**
   * A metric of a server's machine passed its alert level, and this user is the member who gets the
   * alert. It shows also while the app has focus, as a usage limit does: nothing else in the window
   * says it. A muted server or the level "nothing" keeps it quiet. A click shows the main window.
   */
  function forwardMachineAlert(serverId: string, event: MachineAlertEvent): void {
    // A host sends the alerts still in force again at each reconnect.
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
    // A computer with no server set up has no server name, so its own name stands for it.
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

  /** Picture in Picture shows the tabs of the server in view, so the other servers' tabs stay out of it. */
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

  function forwardProviderRuntimeStatus(snapshot: import("@openbot/contracts/ipc").ProviderRuntimeSnapshot): void {
    for (const window of appWindows()) sendToRenderer(window, IPC_ENDPOINTS.providerRuntimes.event, snapshot);
  }

  function forwardGitHubConnectorStatus(status: import("@openbot/contracts/ipc").GitHubConnectorStatus): void {
    for (const window of appWindows()) sendToRenderer(window, IPC_ENDPOINTS.githubConnector.changed, status);
  }

  function forwardOnePasswordConnectorStatus(
    status: import("@openbot/contracts/ipc").OnePasswordConnectorStatus,
  ): void {
    for (const window of appWindows()) sendToRenderer(window, IPC_ENDPOINTS.onePasswordConnector.changed, status);
  }

  function forwardBitwardenConnectorStatus(status: import("@openbot/contracts/ipc").BitwardenConnectorStatus): void {
    for (const window of appWindows()) sendToRenderer(window, IPC_ENDPOINTS.bitwardenConnector.changed, status);
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

  return {
    forwardAgentEvent,
    forwardWorkflowNotice,
    forwardMachineAlert,
    forwardBrowserDisplayState,
    forwardUpdateStatus,
    forwardUpdatePreference,
    forwardVoiceModelStatus,
    forwardVoiceStreamTranscript,
    forwardSpeechModelStatus,
    forwardVoiceServerSettings,
    forwardProviderRuntimeStatus,
    forwardGitHubConnectorStatus,
    forwardOnePasswordConnectorStatus,
    forwardBitwardenConnectorStatus,
    forwardVaultState,
    forwardHostStatus,
    forwardRemoteDesktopSessions,
    forwardServers,
    forwardTeamPresence,
    forwardDirectMessage,
    forwardDirectTyping,
  };
}
