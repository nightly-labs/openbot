import {
  type AgentEvent,
  type CreateAgentInput,
  canAdministerServer,
  isQueuedMessageReceipt,
  MCP_SERVERS_CAPABILITY,
  type RespondToApprovalInput,
  type SidebarLayoutSnapshot,
  type TeamRealtimeEvent,
  type UpdateAgentInput,
} from "@openbot/contracts/ipc";
import { TEAM_API_ROUTES } from "@openbot/contracts/team-api-routes";
import { AGENT_ACCESS_CAPABILITY } from "@openbot/contracts/team-protocol/agent-access-v1";
import { AGENT_ADMIN_CAPABILITY } from "@openbot/contracts/team-protocol/agent-admin-v1";
import { AGENT_HOST_SETTINGS_CAPABILITY } from "@openbot/contracts/team-protocol/agent-host-settings-v1";
import { AGENT_INSTALL_CAPABILITY } from "@openbot/contracts/team-protocol/agent-install-v1";
import { AGENT_MEMORY_LIMIT_CAPABILITY } from "@openbot/contracts/team-protocol/agent-memory-limit-v1";
import { AGENT_PUBLISH_CAPABILITY } from "@openbot/contracts/team-protocol/agent-publish-v1";
import { AGENT_UPDATE_CAPABILITY } from "@openbot/contracts/team-protocol/agent-update-v1";
import { BITWARDEN_CONNECTOR_CAPABILITY } from "@openbot/contracts/team-protocol/bitwarden-connector-v1";
import { CONNECTORS_CAPABILITY } from "@openbot/contracts/team-protocol/connectors-v1";
import { TEAM_AGENT_CREATE_MODEL_CAPABILITY } from "@openbot/contracts/team-protocol/current";
import { EVENTS_CAPABILITY } from "@openbot/contracts/team-protocol/events-v1";
import { FOCUS_USE_CAPABILITY, FOCUS_USE_ROUTES } from "@openbot/contracts/team-protocol/focus-use-v1";
import { HOST_ADMIN_CAPABILITY } from "@openbot/contracts/team-protocol/host-admin-v1";
import { HOST_MEMBER_UPDATE_CAPABILITY } from "@openbot/contracts/team-protocol/host-member-update-v1";
import { HOST_RELEASE_CAPABILITY } from "@openbot/contracts/team-protocol/host-release-v1";
import { HOST_TIMEZONE_CAPABILITY } from "@openbot/contracts/team-protocol/host-timezone-v1";
import { HOST_UPDATE_CAPABILITY } from "@openbot/contracts/team-protocol/host-update-v1";
import { HOSTED_SITES_CAPABILITY } from "@openbot/contracts/team-protocol/hosted-sites-v1";
import { LIVE_ACTIVITY_PUSH_CAPABILITY } from "@openbot/contracts/team-protocol/live-activity-push-v1";
import { ONEPASSWORD_CONNECTOR_CAPABILITY } from "@openbot/contracts/team-protocol/onepassword-connector-v1";
import { PROVIDER_ACCOUNTS_CAPABILITY } from "@openbot/contracts/team-protocol/provider-accounts-v1";
import { PROVIDERS_ADMIN_CAPABILITY } from "@openbot/contracts/team-protocol/providers-v1";
import { ANDROID_PUSH_NOTIFICATIONS_CAPABILITY } from "@openbot/contracts/team-protocol/push-notifications-android-v1";
import { PUSH_NOTIFICATIONS_CAPABILITY } from "@openbot/contracts/team-protocol/push-notifications-v1";
import { ROUTINE_RECOVERY_CAPABILITY } from "@openbot/contracts/team-protocol/routine-recovery-v1";
import { ROUTINE_RESULTS_CAPABILITY } from "@openbot/contracts/team-protocol/routine-results-v1";
import { SHARED_TABLES_CAPABILITY } from "@openbot/contracts/team-protocol/shared-tables-v1";
import { SIGN_IN_RELAY_CAPABILITY } from "@openbot/contracts/team-protocol/sign-in-relay-v1";
import { SKILLS_ADMIN_CAPABILITY } from "@openbot/contracts/team-protocol/skills-admin-v1";
import type { TeamProtocolV2Json } from "@openbot/contracts/team-protocol/v2";
import { TEAM_PROTOCOL_V3 } from "@openbot/contracts/team-protocol/v3";
import { decodeTeamProtocolSupportV9 } from "@openbot/contracts/team-protocol/v9";
import { VAULT_IMPORT_CAPABILITY } from "@openbot/contracts/team-protocol/vault-import-v1";
import { VAULT_CAPABILITY } from "@openbot/contracts/team-protocol/vault-v1";
import { VAULT_V2_CAPABILITY } from "@openbot/contracts/team-protocol/vault-v2";
import { sourceText } from "@openbot/i18n/source";
import {
  createRemoteAccountRefresh,
  createRemoteReadRefresh,
  createWorkspacePreferences,
  type RemoteConnectionFailure,
  type RemoteConnectionStage,
  type RemoteRecoveryStatus,
  RemoteTeamDirectoryClient,
  type RemoteTeamHost,
  type RemoteWorkspacePreferences,
  readAgentAnalytics,
  remoteRecoveryMessage,
  runTeamEffect,
} from "@openbot/team-client";
import { verifyEd25519Base64Url } from "@openbot/team-client/ed25519";
import { createFocusUsePing } from "@openbot/team-client/focus-use";
import { createHostedServerWake, WAKE_RECONNECT_DELAY_MS } from "@openbot/team-client/hosted-server-wake";
import type { RemoteFileUpload } from "@openbot/team-client/remote-peer";
import { updateHostIdentity } from "@openbot/team-client/team-admin-requests";
import {
  deleteAgent,
  discardAttachmentDraft,
  interruptAgentTurn,
  respondToApproval,
  respondToBrowserSecret,
  respondToBrowserTakeover,
  type TeamApiRequest,
  uploadAttachmentDraft,
} from "@openbot/team-client/team-api-requests";
import { replaceEqualDeep, useQueryClient } from "@tanstack/react-query";
import { Effect } from "effect";
import * as Crypto from "expo-crypto";
import { type PropsWithChildren, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { View } from "react-native";
import { showFailureAlert } from "@/features/analytics/failure-reports";
import { mobileAnalytics } from "@/features/analytics/mobile-analytics";
import { trackWorkspaceActions } from "@/features/analytics/workspace-actions";
import { useMobileSession } from "@/features/auth/context/mobile-session-context";
import { decodeMobileBrowserTabs } from "@/features/browser/model/browser-tabs";
import { MobileChannelStore } from "@/features/channels/model/channel-store";
import { useLiveActivity } from "@/features/live-activity/use-live-activity";
import { usePushNotifications } from "@/features/push-notifications/use-push-notifications";
import { useSyncedNotificationLevelsLoader } from "@/features/push-notifications/use-synced-notification-levels";
import { QuickActionsSync } from "@/features/quick-actions/quick-actions-sync";
import { setSyncedNotificationLevels } from "@/features/settings/model/notification-levels";
import { ShareExtensionSync } from "@/features/share/share-extension-sync";
import { fetch } from "@/features/support/model/logged-fetch";
import { supportLog } from "@/features/support/model/support-log";
import type { RemoteTeamTransportRef } from "@/features/workspace/components/remote-team-transport";
import {
  ServerConnection,
  type ServerConnectionHandle,
  type ServerLoadContext,
} from "@/features/workspace/components/server-connection";
import { createBrowserActions } from "@/features/workspace/context/browser-actions";
import {
  createHostRequestActions,
  hostOwnsHide,
  readHostHiddenAgents,
  requestAgentAvatar,
  writeHostAgentHidden,
} from "@/features/workspace/context/host-request-actions";
import {
  createRecoveryCountdowns,
  RecoveryCountdownContext,
} from "@/features/workspace/context/server-recovery-countdown";
import { useConversationReads } from "@/features/workspace/context/use-conversation-reads";
import { useServerOrder } from "@/features/workspace/context/use-server-order";
import { createWorkflowActions } from "@/features/workspace/context/workflow-actions";
import { WorkspaceContexts } from "@/features/workspace/context/workspace-store";
import { reduceAgentActivity } from "@/features/workspace/model/agent-activity";
import {
  agentAvatarDataUrl,
  deleteServerAvatars,
  saveAgentAvatar,
} from "@/features/workspace/model/agent-avatar-cache";
import {
  canToggleAgentPin,
  reconcileAgentPins,
  reconcileChannelPins,
  setChannelHidden,
} from "@/features/workspace/model/agent-pins";
import { ConnectionWaits } from "@/features/workspace/model/connection-waits";
import { conversationMessageId, decodeConversationPage } from "@/features/workspace/model/conversation";
import { MobileConversationStore } from "@/features/workspace/model/conversation-store";
import { LiveWorkspaceStore } from "@/features/workspace/model/live-workspace-store";
import {
  dropApproval,
  InactiveRequestError,
  reducePendingApprovals,
} from "@/features/workspace/model/pending-approvals";
import { type QueryScope, queryKeys } from "@/features/workspace/model/query-keys";
import {
  hasCapability,
  requireCapability,
  SIDEBAR_LAYOUT_CAPABILITY,
  supportsBrowserView,
} from "@/features/workspace/model/server-capabilities";
import { serverAccent } from "@/features/workspace/model/server-order";
import {
  applyServerRecovery,
  sameServerRecovery,
  serverFromHost,
  serverKind,
  showsOnline,
} from "@/features/workspace/model/server-status";
import { withoutTaskTurns } from "@/features/workspace/model/task-cache";
import { applyBrowserEvent, syncEventQueries } from "@/features/workspace/model/team-events";
import { runTeamRequest } from "@/features/workspace/model/team-request";
import { trustedHostKeys } from "@/features/workspace/model/trusted-host-keys";
import { appendTurnStepLine, latestThoughtId } from "@/features/workspace/model/turn-step-lines";
import {
  decodeAgent,
  decodeAgentSummaries,
  decodeConversationReads,
  decodeSidebarLayout,
  ignoreResponse,
  projectAgent,
  type RemoteAgent,
  remoteAgentOf,
  updateAgentPayload,
} from "@/features/workspace/model/workspace-records";
import type {
  MobileAgent,
  MobileServer,
  MobileServerDirectoryState,
  MobileWorkspaceActions,
  MobileWorkspaceContextValue,
  MobileWorkspaceState,
} from "@/features/workspace/model/workspace-types";
import * as LockedKeychain from "@/shared/lib/locked-keychain";
import { isAndroid } from "@/shared/lib/platform";
import { currentText } from "@/shared/lib/text";
import { useAppForeground } from "@/shared/lib/use-app-foreground";

export {
  useMobileWorkspace,
  useMobileWorkspaceActions,
  useMobileWorkspaceReader,
  useMobileWorkspaceSelector,
} from "@/features/workspace/context/workspace-store";
export type {
  MobileAgent,
  MobileServer,
  MobileServerDirectoryState,
  MobileWorkspaceActions,
  MobileWorkspaceContextValue,
  MobileWorkspaceState,
} from "@/features/workspace/model/workspace-types";

const NO_IDS: string[] = [];
const NO_AGENTS: MobileAgent[] = [];
/** The longest that the servers which are not selected wait for the selected one on a return to the app. */
const OTHER_SERVERS_RETURN_DELAY_MS = 3_000;
/** How long the app waits at start for the first server before it opens a server that is online. */
const STARTUP_SERVER_WAIT_MS = 4_000;
const EMPTY_SERVER: MobileServer = {
  id: "unavailable",
  name: "OpenBot",
  logoKey: null,
  kind: "local",
  state: "connecting",
  initialConnectionPending: true,
  connectionMessage: null,
  address: null,
  accent: serverAccent("unavailable"),
  publicKey: "",
  membershipId: "",
  role: "member",
};

/**
 * The reads that make a server usable, chosen by its capabilities. Each connection reads the hidden
 * list again, because the events of an interrupted connection are lost. A failed hidden read keeps
 * the last list and does not stop the connection.
 */
function startWorkspaceReads(client: RemoteTeamTransportRef, capabilities: readonly string[]) {
  const sections = capabilities.includes(SIDEBAR_LAYOUT_CAPABILITY)
    ? client.request("GET", TEAM_API_ROUTES.sidebarLayout.state, decodeSidebarLayout)
    : null;
  const agents = client.request("GET", TEAM_API_ROUTES.agents.all, decodeAgentSummaries);
  // The hidden list loads with the agents, so a hidden agent does not show for a moment.
  const hidden = readHostHiddenAgents(
    (method, path, decode, body) => client.request(method, path, decode, body),
    capabilities,
  ).catch(() => undefined);
  // Reads that start before the compatibility check can lose their reader when the check fails.
  sections?.catch(() => undefined);
  agents.catch(() => undefined);
  return { sections, agents, hidden };
}

function sameCapabilities(a: readonly string[], b: readonly string[]): boolean {
  return a.length === b.length && a.every((capability) => b.includes(capability));
}

/** The record without `keys`, or the same record when it has none of them. */
function withoutKeys<T>(record: Record<string, T>, keys: ReadonlySet<string>): Record<string, T> {
  return Object.keys(record).some((key) => keys.has(key))
    ? Object.fromEntries(Object.entries(record).filter(([key]) => !keys.has(key)))
    : record;
}

export function MobileWorkspaceProvider({ children }: PropsWithChildren) {
  const { session, sessionScope } = useMobileSession();
  const queryClient = useQueryClient();
  useEffect(() => () => queryClient.removeQueries({ queryKey: queryKeys.chatQueue() }), [queryClient]);
  const presenceSignatures = useRef(new Map<string, string>());
  const [memberCountByServer, setMemberCountByServer] = useState<Readonly<Record<string, number>>>({});
  if (!session) throw new Error("MobileWorkspaceProvider requires a signed-in mobile session.");
  const queryScope = useMemo<QueryScope>(
    () => [session.apiUrl, session.user.id, sessionScope],
    [session.apiUrl, session.user.id, sessionScope],
  );

  const directory = useMemo(
    () =>
      new RemoteTeamDirectoryClient({
        apiUrl: session.apiUrl,
        token: session.sessionToken,
        fetch,
        hostKeys: trustedHostKeys(session.apiUrl, session.user.id),
        pairedHost: session.host,
        verifyHostKeySignature: verifyEd25519Base64Url,
      }),
    [session.apiUrl, session.sessionToken, session.user.id, session.host],
  );
  const connections = useRef(new Map<string, ServerConnectionHandle>());
  const [connectionWaits] = useState(() => new ConnectionWaits());
  const loadGeneration = useRef(0);
  const directoryGeneration = useRef(0);
  const foreground = useAppForeground();
  const [servers, setServers] = useState<MobileServer[]>([]);
  const [serverDirectoryState, setServerDirectoryState] = useState<MobileServerDirectoryState>("loading");
  const [serverDirectoryError, setServerDirectoryError] = useState<string | null>(null);
  const serversRef = useRef(servers);
  serversRef.current = servers;
  const [sidebarByServer, setSidebarByServer] = useState<
    Record<string, { layout: SidebarLayoutSnapshot | null; error: string | null }>
  >({});
  const applySidebarLayout = useCallback((serverId: string, layout: SidebarLayoutSnapshot) => {
    if (removedServers.current.has(serverId)) return;
    setSidebarByServer((current) => {
      const previous = current[serverId]?.layout;
      if (previous && previous.revision > layout.revision) return current;
      return { ...current, [serverId]: { layout, error: null } };
    });
  }, []);
  const [agents, setAgents] = useState<MobileAgent[]>([]);
  const agentsRef = useRef(agents);
  agentsRef.current = agents;
  // Keep former agent IDs too, so leaving also removes cached chats of deleted agents.
  const serverAgentIds = useRef(new Map<string, Set<string>>());
  const removedServers = useRef(new Set<string>());
  const readRefresh = useMemo(() => createRemoteReadRefresh(), []);
  const serverCapabilities = useRef(new Map<string, readonly string[]>());
  const { serverOrder, defaultServerId, orderedServers, sortByPreference, reorderServers } = useServerOrder(
    session.apiUrl,
    session.user.id,
    session.host?.hostId,
    servers,
  );
  // The app opens on the first server of the list. The directory corrects a saved server that is gone.
  const [activeServerId, setActiveServerId] = useState<string | null>(() => defaultServerId ?? serverOrder[0] ?? null);
  const activeServerIdRef = useRef(activeServerId);
  activeServerIdRef.current = activeServerId;
  const conversationStore = useMemo(
    () =>
      new MobileConversationStore((flush) => {
        const frame = requestAnimationFrame(flush);
        return () => cancelAnimationFrame(frame);
      }),
    [],
  );
  useEffect(() => () => conversationStore.dispose(), [conversationStore]);
  const [liveState] = useState(() => new LiveWorkspaceStore());
  const preferenceStore = useMemo(
    () =>
      createWorkspacePreferences(session.apiUrl, session.user.id, {
        // The keychain that a locked phone can read (`locked-keychain.ts`), with the session.
        get: (key) => LockedKeychain.getItem(key),
        set: (key, value) => LockedKeychain.setItem(key, value),
      }),
    [session.apiUrl, session.user.id],
  );
  const [preferences, setPreferences] = useState<Record<string, RemoteWorkspacePreferences>>({});
  const preferencesRef = useRef(preferences);
  preferencesRef.current = preferences;
  /**
   * The hidden agents of each server that serves `agent-hidden-v1`. The host owns this list, and each
   * device of the server shows it. A server without the capability has no entry.
   */
  const [hostHidden, setHostHidden] = useState<Record<string, string[]>>({});
  const hostHiddenRef = useRef(hostHidden);
  hostHiddenRef.current = hostHidden;
  // The local list stays: it is the only list of an older host, and an agent hidden on this phone
  // before the host had the capability stays hidden. The phone does not send it to the host.
  const localHiddenIds = (activeServerId ? preferences[activeServerId]?.hidden : null) ?? NO_IDS;
  const hostHiddenIds = (activeServerId ? hostHidden[activeServerId] : null) ?? NO_IDS;
  const hiddenAgentIds = useMemo(
    () =>
      hostHiddenIds.length === 0
        ? localHiddenIds
        : localHiddenIds.length === 0
          ? hostHiddenIds
          : [...new Set([...localHiddenIds, ...hostHiddenIds])],
    [localHiddenIds, hostHiddenIds],
  );
  /** The saved preferences with the host hidden lists added, for the views that leave out hidden chats. */
  const visiblePreferences = useMemo(() => {
    let next = preferences;
    for (const [serverId, ids] of Object.entries(hostHidden)) {
      const current = preferences[serverId];
      if (!current || ids.length === 0) continue;
      if (next === preferences) next = { ...preferences };
      next[serverId] = { ...current, hidden: [...new Set([...current.hidden, ...ids])] };
    }
    return next;
  }, [preferences, hostHidden]);
  /** Puts the whole hidden list of a host in place; null drops the list of a host without the capability. */
  const applyHostHidden = useCallback((serverId: string, hidden: readonly { agentId: string }[] | null) => {
    if (removedServers.current.has(serverId)) return;
    setHostHidden((current) => {
      if (hidden === null) {
        if (!(serverId in current)) return current;
        const next = { ...current };
        delete next[serverId];
        return next;
      }
      const ids = replaceEqualDeep(
        current[serverId],
        hidden.map((agent) => agent.agentId),
      );
      return ids === current[serverId] ? current : { ...current, [serverId]: ids };
    });
  }, []);
  const pinnedAgentIds = (activeServerId ? preferences[activeServerId]?.pinned : null) ?? NO_IDS;
  const hiddenChannelIds = (activeServerId ? preferences[activeServerId]?.hiddenChannels : null) ?? NO_IDS;
  const pinnedChannelIds = (activeServerId ? preferences[activeServerId]?.pinnedChannels : null) ?? NO_IDS;
  const pinnedWorkflowIds = useMemo(() => {
    const pins: Record<string, readonly string[]> = {};
    for (const [serverId, saved] of Object.entries(preferences))
      if (saved.pinnedWorkflows?.length) pins[serverId] = saved.pinnedWorkflows;
    return pins;
  }, [preferences]);

  /**
   * Drops the local state of servers that this account no longer has: their waiting requests, cached
   * reads, agents, chats and live state. Their saved preferences stay; `forgetServer` clears them.
   */
  const dropServerState = useCallback(
    (serverIds: ReadonlySet<string>) => {
      if (!serverIds.size) return;
      const removedAgentIds = new Set<string>();
      for (const serverId of serverIds) {
        removedServers.current.add(serverId);
        deleteServerAvatars(serverId);
        connectionWaits.drop(serverId, new Error(currentText().t("mobile.workspace.error.transportNotReady")));
        readRefresh.invalidate(serverId);
        for (const id of serverAgentIds.current.get(serverId) ?? []) removedAgentIds.add(id);
        serverAgentIds.current.delete(serverId);
        presenceSignatures.current.delete(serverId);
        for (const queryKey of [
          queryKeys.chatQueue(serverId),
          queryKeys.serverMembers(queryScope, serverId),
          queryKeys.serverInvites(queryScope, serverId),
          queryKeys.agentAvatar(queryScope, serverId),
          queryKeys.serverLogo(queryScope, serverId),
        ])
          queryClient.removeQueries({ queryKey });
      }
      setSidebarByServer((current) => withoutKeys(current, serverIds));
      setHostHidden((current) => withoutKeys(current, serverIds));
      setAgents((current) => current.filter((agent) => !serverIds.has(agent.serverId)));
      for (const id of removedAgentIds) conversationStore.remove(id);
      liveState.update("unreadAgentIds", (current) => current.filter((id) => !removedAgentIds.has(id)));
      liveState.update("unreadCounts", (current) => withoutKeys(current, removedAgentIds));
      liveState.update("activityByServer", (current) => withoutKeys(current, serverIds));
      liveState.update("turnLinesByServer", (current) => withoutKeys(current, serverIds));
      liveState.update("approvalRequests", (current) => withoutKeys(current, serverIds));
      liveState.update("browserRequests", (current) => withoutKeys(current, serverIds));
      liveState.update("browserTabs", (current) => withoutKeys(current, serverIds));
    },
    [connectionWaits, readRefresh, queryClient, queryScope, conversationStore, liveState],
  );

  const installHosts = useCallback(
    (hosts: RemoteTeamHost[]) => {
      const available = new Set(hosts.map((host) => host.hostId));
      dropServerState(new Set(serversRef.current.filter((server) => !available.has(server.id)).map(({ id }) => id)));
      for (const host of hosts) removedServers.current.delete(host.hostId);
      setServers((current) => {
        const previousServers = new Map(current.map((server) => [server.id, server]));
        return hosts.map((host) =>
          serverFromHost(host, serverKind(host.hostId, session.host?.hostId), previousServers.get(host.hostId)),
        );
      });
      setActiveServerId((current) =>
        hosts.some((host) => host.hostId === current)
          ? current
          : (sortByPreference(hosts.map((host) => ({ id: host.hostId })))[0]?.id ?? null),
      );
    },
    [dropServerState, session.host?.hostId, sortByPreference],
  );

  const directoryRefresh = useMemo(
    () =>
      createRemoteAccountRefresh(() =>
        Effect.gen(function* () {
          const generation = ++directoryGeneration.current;
          setServerDirectoryState("loading");
          setServerDirectoryError(null);
          const hosts = yield* directory.listHosts().pipe(
            Effect.tapError((error) =>
              Effect.sync(() => {
                if (generation !== directoryGeneration.current) return;
                setServerDirectoryState("error");
                const text = currentText();
                setServerDirectoryError(
                  text.errorMessage(error, text.t("mobile.workspace.error.directoryUnavailable")),
                );
              }),
            ),
          );
          if (generation !== directoryGeneration.current) return;
          installHosts(hosts);
          setServerDirectoryState("ready");
        }),
      ),
    [directory, installHosts],
  );
  const refreshHosts = useCallback(() => runTeamEffect(directoryRefresh.refresh(true)), [directoryRefresh]);
  const refreshMemberships = useCallback(() => {
    directoryGeneration.current += 1;
    directoryRefresh.invalidate();
    return runTeamEffect(directoryRefresh.refresh(true));
  }, [directoryRefresh]);

  useEffect(() => {
    return () => {
      directoryGeneration.current += 1;
      directoryRefresh.setActive(false);
    };
  }, [directoryRefresh]);

  const attachmentDownloads = useRef<Promise<void>>(Promise.resolve());
  const request = useCallback(
    async <T,>(
      method: string,
      path: string,
      decode: (value: unknown) => T,
      body?: TeamProtocolV2Json,
      serverId = activeServerIdRef.current,
      upload?: RemoteFileUpload,
      onUploadProgress?: (fraction: number) => void,
    ): Promise<T> => {
      if (serverId) await connectionWaits.whenConnected(serverId);
      const client = serverId ? connections.current.get(serverId)?.client : null;
      if (!client) throw new Error(currentText().t("mobile.workspace.error.transportNotReady"));
      return client.request(method, path, decode, body, upload, onUploadProgress);
    },
    [connectionWaits],
  );
  // The query of `AgentPhoto`, so the Live Activity and the photo share one transfer and one copy.
  // The Live Activity takes a data URL.
  const loadAgentAvatar = useCallback(
    (agentId: string, avatarUrl: string, serverId: string) =>
      queryClient
        .fetchQuery({
          queryKey: queryKeys.agentAvatar(queryScope, serverId, agentId, avatarUrl),
          queryFn: () => requestAgentAvatar(request, agentId, avatarUrl, serverId),
          staleTime: Infinity,
        })
        .then(agentAvatarDataUrl),
    [request, queryClient, queryScope],
  );
  const postLiveActivityAction = useCallback(
    (serverId: string, path: string, body: TeamProtocolV2Json) => request("POST", path, ignoreResponse, body, serverId),
    [request],
  );
  const supportsLiveActivityPush = useCallback(
    (serverId: string) => hasCapability(serverCapabilities.current, serverId, LIVE_ACTIVITY_PUSH_CAPABILITY),
    [],
  );
  const applyLiveActivityEvent = useLiveActivity({
    servers,
    activeServerId,
    agents,
    liveState,
    foreground,
    post: postLiveActivityAction,
    loadAgentAvatar,
    supportsPush: supportsLiveActivityPush,
  });
  // An iPhone and an Android phone register through capabilities of their own.
  const supportsPushNotifications = useCallback(
    (serverId: string) =>
      hasCapability(
        serverCapabilities.current,
        serverId,
        isAndroid ? ANDROID_PUSH_NOTIFICATIONS_CAPABILITY : PUSH_NOTIFICATIONS_CAPABILITY,
      ),
    [],
  );
  usePushNotifications({
    servers,
    serversReady: serverDirectoryState === "ready",
    foreground,
    post: postLiveActivityAction,
    supportsPush: supportsPushNotifications,
  });
  /** The shared Team API requests, sent to one server. */
  const teamApi = useCallback(
    (serverId?: string, onUploadProgress?: (fraction: number) => void): TeamApiRequest =>
      (method, path, decode, body, upload) =>
        request(method, path, decode, body, serverId, upload, onUploadProgress),
    [request],
  );

  /** The open channels of each server that the routine calendar last read its owners from. */
  const calendarChannels = useRef(new Map<string, string>());
  const channelStore = useMemo(
    () =>
      new MobileChannelStore(request, (serverId, channels) => {
        // The calendar leaves out archived channels. Message streaming also sends `channels-changed`,
        // so the calendar reloads only when the set of open channels changes: an archive, a restore,
        // a new channel or a deleted one.
        const open = channels
          .filter((channel) => !channel.archived)
          .map((channel) => channel.id)
          .sort()
          .join("\n");
        const previous = calendarChannels.current.get(serverId);
        calendarChannels.current.set(serverId, open);
        if (previous !== undefined && previous !== open)
          void queryClient.invalidateQueries({ queryKey: queryKeys.serverRoutines(queryScope, serverId) });
        const pinned = preferencesRef.current[serverId]?.pinnedChannels;
        if (!pinned?.length) return;
        const available = new Set(channels.map((channel) => channel.id));
        if (pinned.every((id) => available.has(id))) return;
        try {
          const saved = reconcileChannelPins(preferenceStore, serverId, channels);
          setPreferences((current) => ({ ...current, [serverId]: saved }));
        } catch (error) {
          showFailureAlert(
            error,
            "settings",
            currentText().t("mobile.workspace.alert.preferencesTitle"),
            currentText().t("mobile.workspace.alert.preferencesBody"),
          );
        }
      }),
    [request, preferenceStore, queryClient, queryScope],
  );
  useEffect(() => () => channelStore.dispose(), [channelStore]);
  useEffect(() => channelStore.setActive(foreground), [channelStore, foreground]);
  useEffect(() => {
    channelStore.retainServers(servers.map((server) => server.id));
  }, [servers, channelStore]);

  const replaceServerAgents = useCallback(
    (serverId: string, summaries: RemoteAgent[]) => {
      try {
        const saved = reconcileAgentPins(preferenceStore, serverId, summaries);
        // agents-changed arrives for each delivered message. Keep unchanged preferences and agents,
        // so the workspace context does not notify every consumer for each message.
        setPreferences((current) => {
          const next = replaceEqualDeep(current[serverId], saved);
          return next === current[serverId] ? current : { ...current, [serverId]: next };
        });
      } catch (error) {
        showFailureAlert(
          error,
          "settings",
          currentText().t("mobile.workspace.alert.preferencesTitle"),
          currentText().t("mobile.workspace.alert.preferencesBody"),
        );
      }
      const knownIds = serverAgentIds.current.get(serverId) ?? new Set<string>();
      for (const agent of summaries) knownIds.add(agent.id);
      serverAgentIds.current.set(serverId, knownIds);
      setAgents((current) => {
        const previous = new Map(
          current.filter((agent) => agent.serverId === serverId).map((agent) => [agent.id, agent]),
        );
        const next = [
          ...current.filter((agent) => agent.serverId !== serverId),
          ...summaries.map((agent) => replaceEqualDeep(previous.get(agent.id), projectAgent(serverId, agent))),
        ];
        return next.length === current.length && next.every((agent, index) => agent === current[index])
          ? current
          : next;
      });
    },
    [preferenceStore],
  );

  const loadConversation = useCallback(
    async (agentId: string, serverId = activeServerIdRef.current, refresh = false, attach = false) => {
      const generation = loadGeneration.current;
      return conversationStore.loadLatest(
        agentId,
        () =>
          request(
            "GET",
            `${TEAM_API_ROUTES.agent.conversationPage(agentId)}?limit=50`,
            decodeConversationPage,
            undefined,
            serverId,
          ),
        () => generation === loadGeneration.current && Boolean(serverId) && !removedServers.current.has(serverId ?? ""),
        refresh,
        attach,
      );
    },
    [request, conversationStore],
  );
  // A stable function: an open chat reloads its history when this changes.
  const loadLatestMessages = useCallback(
    async (agentId: string, serverId?: string) => {
      await loadConversation(agentId, serverId, true, true);
    },
    [loadConversation],
  );
  const loadConversationAround = useCallback(
    async (agentId: string, messageId: string, serverId = activeServerIdRef.current) => {
      const generation = loadGeneration.current;
      // A query parameter never reaches the JSON adapters. A host that does not know `around` sends the
      // latest page, which does not hold an older message, so the chat then opens at the latest message.
      const page = await request(
        "GET",
        `${TEAM_API_ROUTES.agent.conversationPage(agentId)}?limit=50&around=${encodeURIComponent(messageId)}`,
        decodeConversationPage,
        undefined,
        serverId,
      );
      if (page.agentId !== agentId) throw new Error("The server returned a page for another conversation.");
      const current =
        generation === loadGeneration.current && Boolean(serverId) && !removedServers.current.has(serverId ?? "");
      if (!current || !page.messages.some((message) => message.id === messageId)) return false;
      conversationStore.applyAround(page);
      return true;
    },
    [request, conversationStore],
  );
  const loadOlderMessages = useCallback(
    async (agentId: string, serverId = activeServerIdRef.current) => {
      const generation = loadGeneration.current;
      await conversationStore.loadOlder(
        agentId,
        (cursor) =>
          request(
            "GET",
            `${TEAM_API_ROUTES.agent.conversationPage(agentId)}?limit=50&before=${encodeURIComponent(cursor ?? "")}`,
            decodeConversationPage,
            undefined,
            serverId,
          ),
        () => generation === loadGeneration.current && Boolean(serverId) && !removedServers.current.has(serverId ?? ""),
      );
    },
    [request, conversationStore],
  );

  const { applyConversationReads, refreshConversationReads, markAgentRead, markAllRead } = useConversationReads({
    liveState,
    readRefresh,
    request,
    loadConversation,
    conversationStore,
    loadGeneration,
    removedServers,
    capabilities: serverCapabilities.current,
    activeServerId: activeServerIdRef,
    agents: agentsRef,
  });

  const loadServer = useCallback(
    async (serverId: string, publicKey: string, client: RemoteTeamTransportRef, context: ServerLoadContext) => {
      // Runtime events and snapshots own activity; workspace reads must preserve it.
      context.stage = "preferences";
      const saved = preferenceStore.read(serverId);
      setPreferences((current) => ({ ...current, [serverId]: saved }));
      context.stage = "connection";
      // Events sent while the connection was down are lost, so open chats read their page again.
      conversationStore.markStale();
      await client.connect(serverId, publicKey);
      if (!context.isCurrent()) return;
      context.stage = "compatibility";
      const compatibilityRead = client.request("GET", TEAM_API_ROUTES.compatibility, decodeTeamProtocolSupportV9);
      // On a reconnect the capabilities of the last connection are known, so the workspace reads go
      // out with the compatibility read and do not wait one more round trip. Their results apply only
      // after the check. The read state applies when it arrives: it does not depend on the protocol,
      // and its refresh must start now to keep its order with the event reads.
      const known = serverCapabilities.current.get(serverId);
      const loadReads = () =>
        runTeamEffect(
          readRefresh.refresh(
            serverId,
            () =>
              Effect.tryPromise(() =>
                client.request("GET", TEAM_API_ROUTES.agents.conversationReads, decodeConversationReads),
              ),
            applyConversationReads,
            () => context.isCurrent() && !removedServers.current.has(serverId),
          ),
        );
      const early = known
        ? { capabilities: known, reads: startWorkspaceReads(client, known), conversationReads: loadReads() }
        : null;
      early?.conversationReads.catch(() => undefined);
      const compatibility = await compatibilityRead;
      if (!context.isCurrent()) return;
      supportLog.add(
        "info",
        "connection",
        `${serverId} host OpenBot ${compatibility.appVersion}, protocol ${compatibility.protocol.minimum}-${compatibility.protocol.maximum}, capabilities: ${compatibility.capabilities.join(" ")}`,
      );
      if (compatibility.protocol.minimum > TEAM_PROTOCOL_V3 || compatibility.protocol.maximum < TEAM_PROTOCOL_V3) {
        throw new Error(sourceText("error.remote.mobileUpdateRequired"));
      }
      serverCapabilities.current.set(serverId, compatibility.capabilities);
      channelStore.configure(serverId, compatibility.capabilities);
      void channelStore.refresh(serverId);
      if (supportsBrowserView(compatibility.capabilities)) {
        // The tabs only add the browser button. A host that cannot list them still loads.
        void client
          .request("GET", TEAM_API_ROUTES.browser.tabs, decodeMobileBrowserTabs)
          .then((tabs) => {
            if (!context.isCurrent()) return;
            liveState.update("browserTabs", (current) => ({
              ...current,
              [serverId]: { tabs, activeTabId: current[serverId]?.activeTabId ?? null },
            }));
          })
          .catch(() => undefined);
      }
      // A host that changed its capabilities, such as after an update, gets the reads that they select.
      const reads =
        early && sameCapabilities(early.capabilities, compatibility.capabilities)
          ? early.reads
          : startWorkspaceReads(client, compatibility.capabilities);
      const conversationReads = early?.conversationReads ?? loadReads();
      // The sections, the agents and the read state do not depend on each other, so they load together.
      // The first read that fails names the stage.
      let failed = false;
      const step = <T,>(stage: RemoteConnectionStage, read: Promise<T>) =>
        read.catch((error: unknown) => {
          if (!failed) context.stage = stage;
          failed = true;
          throw error;
        });
      const sections = reads.sections
        ? reads.sections.then(
            (layout) => {
              if (context.isCurrent()) applySidebarLayout(serverId, layout);
            },
            (error: unknown) => {
              if (!context.isCurrent()) return;
              const text = currentText();
              const message = text.errorMessage(error, text.t("mobile.workspace.error.sectionsLoadFailed"));
              setSidebarByServer((current) => ({
                ...current,
                [serverId]: {
                  layout: current[serverId]?.layout ?? null,
                  error: message,
                },
              }));
            },
          )
        : setSidebarByServer((current) => ({ ...current, [serverId]: { layout: null, error: null } }));
      const [summaries] = await Promise.all([
        step(
          "agents",
          Promise.all([reads.agents, reads.hidden]).then(([summaries, hiddenAgents]) => {
            if (context.isCurrent()) {
              if (hiddenAgents !== undefined) applyHostHidden(serverId, hiddenAgents);
              replaceServerAgents(serverId, summaries);
            }
            return summaries;
          }),
        ),
        step("reads", conversationReads),
        sections,
      ]);
      if (!context.isCurrent()) return;
      // The server is usable now, so the reconnect status does not wait for every cached chat. They
      // load again after it, the open chat first. A lost connection stops them, and the next attempt
      // loads them again; a chat that does not load here loads when it opens.
      const ordered = [...summaries].sort(
        (a, b) => Number(conversationStore.isObserved(b.id)) - Number(conversationStore.isObserved(a.id)),
      );
      void (async () => {
        for (const agent of ordered) {
          if (!context.isCurrent()) return;
          if (!conversationStore.get(agent.id)) continue;
          await conversationStore
            .loadLatest(
              agent.id,
              () =>
                client.request(
                  "GET",
                  `${TEAM_API_ROUTES.agent.conversationPage(agent.id)}?limit=50`,
                  decodeConversationPage,
                ),
              context.isCurrent,
              true,
            )
            .catch(() => undefined);
        }
      })();
      context.stage = "connection";
    },
    [
      replaceServerAgents,
      applyHostHidden,
      preferenceStore,
      readRefresh,
      conversationStore,
      channelStore,
      applySidebarLayout,
      applyConversationReads,
      liveState,
    ],
  );

  const registerConnection = useCallback((hostId: string, handle: ServerConnectionHandle | null) => {
    if (handle) connections.current.set(hostId, handle);
    else connections.current.delete(hostId);
  }, []);
  const wakeHostedServer = useMemo(
    () =>
      createHostedServerWake((hostId) =>
        Effect.tryPromise((signal) =>
          fetch(new URL(`/v2/hosting/servers/${encodeURIComponent(hostId)}/wake`, session.apiUrl).toString(), {
            method: "POST",
            headers: { Authorization: `Bearer ${session.sessionToken}` },
            signal,
          }),
        ),
      ),
    [session.apiUrl, session.sessionToken],
  );
  const foregroundRef = useRef(foreground);
  foregroundRef.current = foreground;
  /** Sends an answer to a request that the host waits on. */
  const sendApproval = useCallback(
    async (serverId: string, input: RespondToApprovalInput) => {
      try {
        await runTeamRequest(respondToApproval(teamApi(serverId), input));
      } catch (error) {
        // Another device answered first, or the turn ended. The request is gone on the host too.
        if (error instanceof InactiveRequestError)
          liveState.update("approvalRequests", (current) => dropApproval(current, serverId, input.requestId));
        throw error;
      }
      // The host answered the agent. Its resolved event can arrive after this, or not at all on a
      // connection that drops now, so the card goes at once.
      liveState.update("approvalRequests", (current) => dropApproval(current, serverId, input.requestId));
    },
    [teamApi, liveState],
  );
  /**
   * Set on background entry with the selected server. Until it clears, the other servers stay
   * inactive. A new selection ends it, so the server that the user leaves keeps its attempt.
   */
  const [hold, setHold] = useState<{ serverId: string | null } | null>(null);
  const othersHeld = hold !== null && hold.serverId === activeServerId;
  const wakeReconnect = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  useEffect(() => () => clearTimeout(wakeReconnect.current), []);
  /** The account server says that the hosted server starts, so the app connects to it again soon. */
  const hostedServerStarting = useCallback((hostId: string) => {
    clearTimeout(wakeReconnect.current);
    wakeReconnect.current = setTimeout(() => connections.current.get(hostId)?.refresh(), WAKE_RECONNECT_DELAY_MS);
  }, []);
  // A hosted server that stopped for no use starts again only for use: the selected server, with the
  // app in the foreground. It connects again when the account server says that it starts.
  const wakeSelectedServer = useCallback(
    (hostId: string) => {
      if (!foregroundRef.current || hostId !== activeServerIdRef.current) return;
      void runTeamEffect(wakeHostedServer(hostId)).then((waking) => {
        if (!waking || hostId !== activeServerIdRef.current) return;
        hostedServerStarting(hostId);
      });
    },
    [wakeHostedServer, hostedServerStarting],
  );
  /** The last failed attempt of each server that asked for a wake. */
  const wakeAttempts = useRef(new Map<string, number>());
  const [recoveryCountdowns] = useState(createRecoveryCountdowns);
  const handleConnectionStatus = useCallback(
    (hostId: string, status: RemoteRecoveryStatus, failure: RemoteConnectionFailure | null, resuming: boolean) => {
      recoveryCountdowns.publish(hostId, { status, message: remoteRecoveryMessage(status, failure?.message ?? null) });
      setServers((current) => {
        const index = current.findIndex((server) => server.id === hostId);
        const server = current[index];
        if (!server) return current;
        const next = applyServerRecovery(server, status, failure?.message ?? null, failure, resuming);
        return sameServerRecovery(server, next) ? current : current.map((item, at) => (at === index ? next : item));
      });
      connectionWaits.setResuming(hostId, resuming && status.phase !== "online");
      // A waiting request goes when the server is online, and fails with the attempt. An attempt that
      // still runs after the quiet time keeps it waiting.
      if (status.phase === "online") connectionWaits.settle(hostId, null);
      else if (!resuming && status.phase !== "connecting")
        connectionWaits.settle(hostId, new Error(sourceText("error.remote.selectedServerOffline")));
      if (status.phase === "online" && hostId === activeServerIdRef.current) setHold(null);
      // The status repeats each second while it waits, so each failed attempt asks once.
      if (status.phase === "online") wakeAttempts.current.delete(hostId);
      if (status.phase !== "waiting" && status.phase !== "cooldown") return;
      if (wakeAttempts.current.get(hostId) === status.attempt) return;
      wakeAttempts.current.set(hostId, status.attempt);
      wakeSelectedServer(hostId);
    },
    [recoveryCountdowns, wakeSelectedServer, connectionWaits],
  );
  // The next retry of an offline server can be 30 seconds away, so a server starts when it is selected.
  useEffect(() => {
    if (!foreground || !activeServerId) return;
    if (serversRef.current.find((server) => server.id === activeServerId)?.state === "offline") {
      wakeSelectedServer(activeServerId);
    }
  }, [foreground, activeServerId, wakeSelectedServer]);
  // A hosted server keeps running while this app is in the foreground (`focus-use-v1`).
  const focusUse = useMemo(
    () =>
      createFocusUsePing(
        (serverId) => void request("POST", FOCUS_USE_ROUTES.ping, ignoreResponse, {}, serverId).catch(() => undefined),
      ),
    [request],
  );
  const activeServerOnline = servers.some((server) => server.id === activeServerId && server.state === "online");
  useEffect(() => {
    const supported = hasCapability(serverCapabilities.current, activeServerId, FOCUS_USE_CAPABILITY);
    focusUse.setTarget(foreground && activeServerOnline && supported ? activeServerId : null);
  }, [focusUse, foreground, activeServerOnline, activeServerId]);
  useEffect(() => () => focusUse.dispose(), [focusUse]);

  useEffect(() => {
    if (!foreground) {
      loadGeneration.current += 1;
      conversationStore.cancelRequests();
      conversationStore.flush();
      // The peer refuses requests in the background too. The next return starts a new quiet time.
      connectionWaits.dropAll(new Error(sourceText("error.remote.appInBackground")));
    }
    directoryRefresh.setActive(foreground);
  }, [foreground, directoryRefresh, conversationStore, connectionWaits]);

  // On a return to the app the selected server connects first; the others follow when it is online,
  // or after a short wait. The phone then sets up the connection the user waits for alone, and the
  // tickets of the other servers reach the account service later.
  useEffect(() => {
    if (!foreground) {
      setHold({ serverId: activeServerIdRef.current });
      return;
    }
    if (!activeServerIdRef.current) {
      setHold(null);
      return;
    }
    const timer = setTimeout(() => setHold(null), OTHER_SERVERS_RETURN_DELAY_MS);
    return () => clearTimeout(timer);
  }, [foreground]);
  // A selection made during the hold ends it, also when the user then selects the first server again.
  useEffect(() => {
    if (hold && hold.serverId !== activeServerId) setHold(null);
  }, [hold, activeServerId]);

  // The app starts on the first server of the list. When that server does not connect soon, such as
  // a computer that sleeps, the first server that is online opens instead. The saved order stays.
  // A selection by the user, or the start server online, ends this. A hosted server stays selected:
  // it starts only while it is selected, and a start takes longer than this wait.
  const startupFallback = useRef(true);
  const [startupWaitOver, setStartupWaitOver] = useState(false);
  // The wait starts when the list of servers arrives, because the connections start then.
  const startServerListed = servers.some((server) => server.id === activeServerId);
  useEffect(() => {
    if (!startServerListed) return;
    const timer = setTimeout(() => setStartupWaitOver(true), STARTUP_SERVER_WAIT_MS);
    return () => clearTimeout(timer);
  }, [startServerListed]);
  useEffect(() => {
    if (!startupFallback.current) return;
    const active = servers.find((server) => server.id === activeServerId);
    if (showsOnline(active) || active?.hosted === true) {
      startupFallback.current = false;
      return;
    }
    const activeFailed = active?.state === "offline" || active?.state === "error";
    if (!startupWaitOver && !activeFailed) return;
    const online = sortByPreference(servers).find((server) => server.state === "online");
    if (!online) return;
    startupFallback.current = false;
    loadGeneration.current += 1;
    conversationStore.cancelRequests();
    setActiveServerId(online.id);
  }, [servers, activeServerId, startupWaitOver, sortByPreference, conversationStore]);

  const handleTeamEvent = useCallback(
    (serverId: string, event: AgentEvent | TeamRealtimeEvent) => {
      if (removedServers.current.has(serverId)) return;
      applyLiveActivityEvent(serverId, event);
      liveState.update("approvalRequests", (current) => {
        const previous = current[serverId] ?? [];
        const next = reducePendingApprovals(previous, event);
        return next === previous ? current : { ...current, [serverId]: next };
      });
      applyBrowserEvent(liveState, serverId, event);
      if (event.type === "sidebar-layout-changed") {
        applySidebarLayout(serverId, event.layout);
        return;
      }
      if (event.type === "hidden-agents-changed") {
        applyHostHidden(serverId, event.agents);
        return;
      }
      // The user changed their levels on another device. A read that started before it is older.
      if (event.type === "agent-notification-levels-changed") {
        setSyncedNotificationLevels(serverId, { server: event.server, agents: event.agents });
        return;
      }
      syncEventQueries(queryClient, queryScope, serverId, event);
      if (event.type === "channels-changed") void channelStore.refresh(serverId, event.channelId);
      if (
        event.type === "channels-changed" ||
        event.type === "channel-memories-changed" ||
        event.type === "channel-routines-changed"
      )
        return;
      if (event.type === "team-presence") {
        const signature = JSON.stringify(
          event.snapshot.members.map((member) => [member.id, member.role, member.disabled, member.online]),
        );
        if (presenceSignatures.current.get(serverId) !== signature) {
          presenceSignatures.current.set(serverId, signature);
          const members = event.snapshot.members.filter((member) => !member.disabled).length;
          setMemberCountByServer((current) =>
            current[serverId] === members ? current : { ...current, [serverId]: members },
          );
          void queryClient.invalidateQueries({ queryKey: queryKeys.serverMembers(queryScope, serverId) });
          void queryClient.invalidateQueries({ queryKey: queryKeys.serverInvites(queryScope, serverId) });
        }
        return;
      }
      // The task events above already wrote the task lists, so a task turn stays out of the chat's activity.
      const chatEvent = withoutTaskTurns(queryClient, queryScope, serverId, event);
      if (
        chatEvent &&
        (chatEvent.type !== "conversation" ||
          chatEvent.snapshot.revision >= (conversationStore.get(chatEvent.snapshot.agentId)?.revision ?? 0))
      ) {
        liveState.update("activityByServer", (current) => {
          const previous = current[serverId] ?? {};
          const next = reduceAgentActivity(previous, chatEvent);
          return next === previous ? current : { ...current, [serverId]: next };
        });
      }
      if (chatEvent?.type === "turn-progress") {
        const { agentId, turnId, detail } = chatEvent;
        const after = latestThoughtId(conversationStore.get(agentId)?.messages ?? [], turnId);
        liveState.update("turnLinesByServer", (current) => {
          const previous = current[serverId] ?? {};
          const next = appendTurnStepLine(previous, turnId, detail, after);
          return next === previous ? current : { ...current, [serverId]: next };
        });
      }
      if (
        event.type === "conversation" ||
        event.type === "conversation-invalidated" ||
        event.type === "turn-completed"
      ) {
        void refreshConversationReads(serverId).catch(() => undefined);
      }
      if (event.type === "agents-changed") {
        replaceServerAgents(serverId, event.agents.map(remoteAgentOf));
      } else if (event.type === "conversation") {
        const knownIds = serverAgentIds.current.get(serverId) ?? new Set<string>();
        knownIds.add(event.snapshot.agentId);
        serverAgentIds.current.set(serverId, knownIds);
        const { agentId, revision, threadId } = event.snapshot;
        if (
          conversationStore.get(agentId) &&
          !conversationStore.holdsRevision(agentId, revision, threadId) &&
          conversationStore.invalidate(agentId)
        )
          void loadConversation(agentId, serverId, true).catch(() => undefined);
      } else if (event.type === "conversation-delta") {
        conversationStore.enqueue(event);
      } else if (event.type === "conversation-page") {
        const readState = event.page.readState;
        if (readState) {
          readRefresh.invalidate(serverId);
          applyConversationReads({ [event.page.agentId]: readState });
        } else void refreshConversationReads(serverId).catch(() => undefined);
        if (conversationStore.get(event.page.agentId)) conversationStore.applyPage(event.page);
      } else if (event.type === "conversation-invalidated") {
        // A read cursor change sends the revision that the phone already has.
        if (
          conversationStore.get(event.agentId) &&
          !conversationStore.holdsRevision(event.agentId, event.revision) &&
          conversationStore.invalidate(event.agentId)
        )
          void loadConversation(event.agentId, serverId, true).catch(() => undefined);
      } else if (event.type === "turn-completed") {
        // The host sends the conversation of the ended turn first, so this joins the read that it started.
        if (conversationStore.get(event.agentId) && conversationStore.invalidate(event.agentId))
          void loadConversation(event.agentId, serverId).catch(() => undefined);
      } else if (event.type === "team-identity") {
        // The host uploads its logo to the account service under its own version, so that version
        // is also the directory key that loads the image.
        setServers((current) =>
          current.map((server) =>
            server.id === serverId ? { ...server, name: event.serverName, logoKey: event.logoVersion } : server,
          ),
        );
      }
    },
    [
      liveState,
      applyLiveActivityEvent,
      channelStore,
      applySidebarLayout,
      applyHostHidden,
      loadConversation,
      replaceServerAgents,
      conversationStore,
      refreshConversationReads,
      readRefresh,
      queryClient,
      queryScope,
      applyConversationReads,
    ],
  );

  const updatePreferences = useCallback(
    (serverId: string, change: (current: RemoteWorkspacePreferences) => RemoteWorkspacePreferences) => {
      try {
        const next = change(preferenceStore.read(serverId));
        preferenceStore.write(serverId, next);
        setPreferences((current) => ({ ...current, [serverId]: next }));
        return next;
      } catch (error) {
        showFailureAlert(
          error,
          "settings",
          currentText().t("mobile.workspace.alert.preferencesTitle"),
          currentText().t("mobile.workspace.alert.preferencesBody"),
        );
        return null;
      }
    },
    [preferenceStore],
  );
  /**
   * Hides or restores an agent on a host that serves `agent-hidden-v1`. The list changes at once; the
   * answer of the host replaces it, and a failure puts the agent back and shows an alert.
   */
  const changeHostHidden = useCallback(
    (serverId: string, agentId: string, hidden: boolean) => {
      const change = (current: Record<string, string[]>, hide: boolean) => {
        const ids = current[serverId] ?? NO_IDS;
        if (ids.includes(agentId) === hide) return current;
        return { ...current, [serverId]: hide ? [...ids, agentId] : ids.filter((id) => id !== agentId) };
      };
      setHostHidden((current) => change(current, hidden));
      const action = hidden ? "hide" : "unhide";
      void writeHostAgentHidden(teamApi(serverId), { agentId, hidden }).then(
        (agents) => {
          applyHostHidden(serverId, agents);
          mobileAnalytics.track("conversation_action", { action, result: "succeeded" });
        },
        (error: unknown) => {
          if (!removedServers.current.has(serverId)) setHostHidden((current) => change(current, !hidden));
          mobileAnalytics.track("conversation_action", { action, result: "failed" });
          const text = currentText();
          showFailureAlert(
            error,
            "agent",
            text.t(hidden ? "mobile.agent.menu.hideFailed" : "mobile.agent.hidden.showFailed"),
            text.errorMessage(error, text.t("mobile.agent.menu.actionFailed")),
          );
        },
      );
    },
    [teamApi, applyHostHidden],
  );

  /** Drops a server that this account left or removed, and its local state. */
  const forgetServer = useCallback(
    (serverId: string) => {
      dropServerState(new Set([serverId]));
      directoryGeneration.current += 1;
      directoryRefresh.invalidate();
      setServerDirectoryState("ready");
      setServerDirectoryError(null);
      if (activeServerIdRef.current === serverId) {
        loadGeneration.current += 1;
        const remaining = serversRef.current.filter((candidate) => candidate.id !== serverId);
        setActiveServerId(sortByPreference(remaining)[0]?.id ?? null);
      }
      setServers((current) => current.filter((candidate) => candidate.id !== serverId));
      updatePreferences(serverId, () => ({ hidden: [], pinned: [] }));
    },
    [dropServerState, directoryRefresh, sortByPreference, updatePreferences],
  );

  const hostRequests = useMemo(
    () =>
      createHostRequestActions({
        request,
        teamApi,
        queryClient,
        queryScope,
        capabilities: serverCapabilities.current,
        attachmentDownloads,
      }),
    [request, teamApi, queryClient, queryScope],
  );
  useSyncedNotificationLevelsLoader({
    servers,
    foreground,
    supports: hostRequests.checks.canSetAgentNotificationLevel,
    load: hostRequests.actions.loadAgentNotificationLevels,
  });
  const workflows = useMemo(
    () => createWorkflowActions({ request, capabilities: serverCapabilities.current }),
    [request],
  );
  const browser = useMemo(
    () =>
      createBrowserActions({
        request,
        liveState,
        client: (serverId) => connections.current.get(serverId)?.client,
        capabilities: serverCapabilities.current,
      }),
    [request, liveState],
  );

  // One object for the session. A command reads the latest workspace from the refs when it runs.
  const actions = useMemo<MobileWorkspaceActions>(() => {
    const currentActiveServer = () =>
      serversRef.current.find((server) => server.id === activeServerIdRef.current) ?? EMPTY_SERVER;
    const currentPinnedAgentIds = () =>
      (activeServerIdRef.current ? preferencesRef.current[activeServerIdRef.current]?.pinned : null) ?? NO_IDS;
    const workspace: MobileWorkspaceActions = {
      ...workflows,
      openBrowserView: browser.openBrowserView,
      controlBrowserTab: browser.controlBrowserTab,
      mutateSidebarLayout: async (serverId, action) => {
        requireCapability(
          serverCapabilities.current,
          serverId,
          SIDEBAR_LAYOUT_CAPABILITY,
          "mobile.workspace.error.sectionsUnsupported",
        );
        const layout = await request(
          "POST",
          TEAM_API_ROUTES.sidebarLayout.actions,
          decodeSidebarLayout,
          action,
          serverId,
        );
        applySidebarLayout(serverId, layout);
      },
      reorderServers,
      channelStore,
      teamDirectory: directory,
      conversationStore,
      liveState,
      respondToApproval: async (serverId, input) => {
        const pending = liveState
          .get()
          .approvalRequests[serverId]?.some((item) => String(item.requestId) === String(input.requestId));
        if (!pending) throw new InactiveRequestError(currentText().t("mobile.workspace.error.approvalInactive"));
        if (!showsOnline(serversRef.current.find((server) => server.id === serverId)))
          throw new Error(currentText().t("mobile.workspace.error.approvalOffline"));
        await sendApproval(serverId, input);
      },
      respondToBrowserTakeover: (serverId, input) => runTeamRequest(respondToBrowserTakeover(teamApi(serverId), input)),
      respondToBrowserSecret: (serverId, input) => runTeamRequest(respondToBrowserSecret(teamApi(serverId), input)),
      selectServer: (id) => {
        startupFallback.current = false;
        loadGeneration.current += 1;
        conversationStore.cancelRequests();
        setActiveServerId(id);
      },
      leaveServer: async (serverId) => {
        const server = serversRef.current.find((candidate) => candidate.id === serverId);
        if (!server || server.role === "owner")
          throw new Error(currentText().t("mobile.workspace.error.leaveOwnServer"));
        await runTeamEffect(directory.leaveHost(server.id, server.membershipId));
        forgetServer(serverId);
      },
      removeServer: async (serverId) => {
        const server = serversRef.current.find((candidate) => candidate.id === serverId);
        if (server?.role !== "owner") throw new Error(currentText().t("mobile.workspace.error.removeOwnedServerOnly"));
        await runTeamEffect(directory.removeOwnedHost(server.id));
        forgetServer(serverId);
      },
      refreshServer: async (serverId) => {
        connections.current.get(serverId)?.refresh();
        await refreshHosts();
      },
      hostedServerStarting,
      updateServerIdentity: async (serverId, input) => {
        const server = serversRef.current.find((candidate) => candidate.id === serverId);
        if (!server || !canAdministerServer(server.role))
          throw new Error(currentText().t("mobile.server.settings.identityNotAllowed"));
        requireCapability(
          serverCapabilities.current,
          serverId,
          HOST_ADMIN_CAPABILITY,
          "mobile.server.settings.identityUnsupported",
        );
        await runTeamRequest(updateHostIdentity(teamApi(serverId), input));
        if (input.serverName !== undefined) {
          const serverName = input.serverName;
          setServers((current) =>
            current.map((candidate) => (candidate.id === serverId ? { ...candidate, name: serverName } : candidate)),
          );
        }
        // The host has written the name and logo to the account service; read the new logo key.
        // A new generation drops a directory read that started before the save, and the refresh
        // reads again after it. The change is saved, so a failed read must not report a failure.
        await refreshMemberships().catch(() => undefined);
      },
      refreshServers: async () => {
        for (const connection of connections.current.values()) connection.refresh();
        await refreshHosts();
      },
      addRemoteServer: async ({ inviteUrl }) => {
        const host = await runTeamEffect(directory.acceptInvite(inviteUrl));
        directoryGeneration.current += 1;
        directoryRefresh.invalidate();
        removedServers.current.delete(host.hostId);
        setServers((current) => [
          ...current.filter((server) => server.id !== host.hostId),
          serverFromHost(host, "remote"),
        ]);
        startupFallback.current = false;
        setActiveServerId(host.hostId);
        // Membership is already committed. Directory failure must not reuse the consumed invite.
        void refreshHosts().catch(() => undefined);
        return host.hostId;
      },
      ...hostRequests.actions,
      loadAgentAnalytics: async (input, serverId) => {
        if (!agentsRef.current.some((agent) => agent.id === input.agentId && agent.serverId === serverId))
          throw new Error(currentText().t("mobile.workspace.error.agentNotOnHost"));
        return runTeamRequest(
          readAgentAnalytics(
            (method, path, decode) => request(method, path, decode, undefined, serverId),
            serverCapabilities.current.get(serverId) ?? [],
            input,
          ),
        );
      },
      createAgent: async (input: CreateAgentInput) => {
        const created = await request("POST", TEAM_API_ROUTES.agents.all, decodeAgent, {
          name: input.name,
          description: input.description,
          avatarSeed: input.avatarSeed,
          avatarHue: input.avatarHue,
          initialMessage: input.initialMessage,
          // The host applies the pair before it queues the initial message. A host without the
          // capability starts its own default.
          ...(input.provider &&
          input.model &&
          hasCapability(serverCapabilities.current, currentActiveServer().id, TEAM_AGENT_CREATE_MODEL_CAPABILITY)
            ? {
                provider: input.provider,
                model: input.model,
                ...(input.reasoningEffort ? { reasoningEffort: input.reasoningEffort } : {}),
              }
            : {}),
        });
        setAgents((current) => [
          ...current.filter((agent) => agent.id !== created.id),
          projectAgent(currentActiveServer().id, created),
        ]);
        return created.id;
      },
      updateAgent: async (input: UpdateAgentInput, serverId = activeServerIdRef.current ?? undefined) => {
        if (!serverId || !agentsRef.current.some((agent) => agent.id === input.agentId && agent.serverId === serverId))
          throw new Error(currentText().t("mobile.workspace.error.agentUnavailableOnHost"));
        const updated = await request(
          "PATCH",
          TEAM_API_ROUTES.agent.one(input.agentId),
          decodeAgent,
          updateAgentPayload(input),
          serverId,
        );
        setAgents((current) =>
          current.map((agent) =>
            agent.id === updated.id && agent.serverId === serverId ? projectAgent(serverId, updated) : agent,
          ),
        );
      },
      setAgentAvatar: async (agentId, image, serverId) => {
        if (!agentsRef.current.some((agent) => agent.id === agentId && agent.serverId === serverId))
          throw new Error(currentText().t("mobile.workspace.error.agentUnavailableOnHost"));
        const updated = await request(
          image ? "PUT" : "DELETE",
          TEAM_API_ROUTES.agent.avatar(agentId),
          decodeAgent,
          undefined,
          serverId,
          image ?? undefined,
        );
        if (image && updated.avatarUrl) {
          queryClient.setQueryData(
            queryKeys.agentAvatar(queryScope, serverId, agentId, updated.avatarUrl),
            saveAgentAvatar(serverId, agentId, updated.avatarUrl, `data:${image.mimeType};base64,${image.base64}`),
          );
        }
        setAgents((current) =>
          current.map((agent) =>
            agent.id === updated.id && agent.serverId === serverId ? projectAgent(serverId, updated) : agent,
          ),
        );
      },
      deleteAgent: (agentId) => runTeamRequest(deleteAgent(teamApi(), agentId)),
      interruptTurn: (agentId, turnId, serverId) =>
        runTeamRequest(interruptAgentTurn(teamApi(serverId), agentId, turnId)),
      loadConversation,
      loadConversationAround,
      loadLatestMessages,
      loadOlderMessages,
      uploadAttachment: async (agentId, input, targetServerId, onProgress) => {
        const serverId = targetServerId ?? agentsRef.current.find((candidate) => candidate.id === agentId)?.serverId;
        if (!serverId) throw new Error(currentText().t("mobile.workspace.error.agentUnavailable"));
        return runTeamRequest(uploadAttachmentDraft(teamApi(serverId, onProgress), input));
      },
      discardAttachment: async (agentId, attachmentId, targetServerId) => {
        const serverId = targetServerId ?? agentsRef.current.find((candidate) => candidate.id === agentId)?.serverId;
        if (!serverId) throw new Error(currentText().t("mobile.workspace.error.agentUnavailable"));
        await runTeamRequest(discardAttachmentDraft(teamApi(serverId), attachmentId));
      },
      sendMessage: async (
        agentId,
        text,
        attachmentDraftIds = [],
        replyToMessageId = null,
        targetServerId,
        clientMessageId,
      ) => {
        const serverId = targetServerId ?? agentsRef.current.find((candidate) => candidate.id === agentId)?.serverId;
        if (!serverId) throw new Error(currentText().t("mobile.workspace.error.agentUnavailable"));
        const receipt = await request(
          "POST",
          TEAM_API_ROUTES.agent.messages(agentId),
          (value) => {
            if (!isQueuedMessageReceipt(value)) throw new Error("The host returned an invalid message receipt.");
            return value;
          },
          {
            text,
            attachmentDraftIds,
            replyToMessageId,
            // The host uses this phone's zone for a routine the agent creates from the message.
            timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
            ...(clientMessageId ? { clientMessageId } : {}),
          },
          serverId,
        );
        return conversationMessageId(receipt, agentId);
      },
      respondToPrompt: async (agentId, input) => {
        const activeServer = currentActiveServer();
        const agent = agentsRef.current.find((candidate) => candidate.id === agentId);
        const snapshot = conversationStore.get(agentId);
        const message = snapshot?.messages.find(
          (item) =>
            item.turnId === snapshot.activeTurnId &&
            item.questionPrompt?.requestId === input.requestId &&
            item.questionPrompt.resolution === null,
        );
        if (
          agent?.serverId !== activeServer.id ||
          !showsOnline(activeServer) ||
          !message?.questionPrompt ||
          message.questionPrompt.resolution ||
          !snapshot?.activeTurnId ||
          message.turnId !== snapshot.activeTurnId
        ) {
          throw new Error(currentText().t("mobile.workspace.error.formUnavailable"));
        }
        await request("POST", TEAM_API_ROUTES.respond.prompt, ignoreResponse, {
          requestId: input.requestId,
          answers: input.answers,
        });
        // The answer is committed even if a subsequent refresh loses connection.
        void loadConversation(agentId).catch(() => undefined);
      },
      hideAgent: (agentId) => {
        const server = currentActiveServer();
        const serverId = server.id;
        if (hostOwnsHide(serverCapabilities.current.get(serverId), server.role)) {
          // The host owns the hide. The pin stays a preference of this phone.
          if (preferencesRef.current[serverId]?.pinned.includes(agentId))
            updatePreferences(serverId, (current) => ({
              ...current,
              pinned: current.pinned.filter((id) => id !== agentId),
            }));
          if (!hostHiddenRef.current[serverId]?.includes(agentId)) changeHostHidden(serverId, agentId, true);
          return;
        }
        const saved = updatePreferences(serverId, (current) => ({
          ...current,
          hidden: [...new Set([...current.hidden, agentId])],
          pinned: current.pinned.filter((id) => id !== agentId),
        }));
        mobileAnalytics.track("conversation_action", { action: "hide", result: saved ? "succeeded" : "failed" });
      },
      unhideAgent: (agentId) => {
        const serverId = currentActiveServer().id;
        // Restore removes the local hide too, so the agent shows again on this phone.
        const saved = updatePreferences(serverId, (current) => ({
          ...current,
          hidden: current.hidden.filter((id) => id !== agentId),
        }));
        if (
          hostOwnsHide(serverCapabilities.current.get(serverId), currentActiveServer().role) &&
          hostHiddenRef.current[serverId]?.includes(agentId)
        ) {
          changeHostHidden(serverId, agentId, false);
          return;
        }
        mobileAnalytics.track("conversation_action", { action: "unhide", result: saved ? "succeeded" : "failed" });
      },
      markAgentRead,
      markAllRead: async () => {
        const serverId = activeServerIdRef.current;
        // The agents and the channels mark read together; the first failure is the one that shows.
        const results = await Promise.allSettled([
          markAllRead(),
          serverId ? channelStore.markAllRead(serverId, Crypto.randomUUID) : undefined,
        ]);
        const failure = results.find((result) => result.status === "rejected");
        if (failure) throw failure.reason;
      },
      markAgentUnread: (agentId) => {
        markAgentRead(agentId, null);
      },
      hideChannel: (id, serverId) =>
        Boolean(updatePreferences(serverId, (current) => setChannelHidden(current, id, true))),
      unhideChannel: (id, serverId) =>
        Boolean(updatePreferences(serverId, (current) => setChannelHidden(current, id, false))),
      toggleChannelPin: (channelId, serverId) => {
        let result: "pinned" | "unpinned" = "pinned";
        const saved = updatePreferences(serverId, (current) => {
          const pinned = current.pinnedChannels ?? [];
          if (!canToggleAgentPin([...current.pinned, ...pinned], channelId)) return current;
          result = pinned.includes(channelId) ? "unpinned" : "pinned";
          return {
            ...current,
            pinnedChannels: result === "unpinned" ? pinned.filter((id) => id !== channelId) : [...pinned, channelId],
          };
        });
        if (!saved || (result === "pinned" && !saved.pinnedChannels?.includes(channelId))) return "error";
        return result;
      },
      toggleWorkflowPin: (workflowId, serverId) => {
        let result: "pinned" | "unpinned" = "pinned";
        const saved = updatePreferences(serverId, (current) => {
          const pinned = current.pinnedWorkflows ?? [];
          result = pinned.includes(workflowId) ? "unpinned" : "pinned";
          return {
            ...current,
            pinnedWorkflows: result === "unpinned" ? pinned.filter((id) => id !== workflowId) : [...pinned, workflowId],
          };
        });
        return saved ? result : "error";
      },
      reconcileWorkflowPins: (serverId, workflowIds) => {
        const pinned = preferencesRef.current[serverId]?.pinnedWorkflows;
        if (!pinned?.some((id) => !workflowIds.includes(id))) return;
        updatePreferences(serverId, (current) => ({
          ...current,
          pinnedWorkflows: (current.pinnedWorkflows ?? []).filter((id) => workflowIds.includes(id)),
        }));
      },
      toggleAgentPin: (agentId) => {
        const pinned = currentPinnedAgentIds();
        const serverId = currentActiveServer().id;
        const pinnedChannels = preferencesRef.current[serverId]?.pinnedChannels ?? NO_IDS;
        if (!canToggleAgentPin([...pinned, ...pinnedChannels], agentId)) return "error";
        if (pinned.includes(agentId)) {
          return updatePreferences(serverId, (current) => ({
            ...current,
            pinned: current.pinned.filter((id) => id !== agentId),
          }))
            ? "unpinned"
            : "error";
        }
        return updatePreferences(serverId, (current) => ({
          ...current,
          pinned: [...new Set([...current.pinned, agentId])],
        }))
          ? "pinned"
          : "error";
      },
    };
    return trackWorkspaceActions(workspace, () => ({
      agents: agentsRef.current,
      pinnedAgentIds: currentPinnedAgentIds(),
    }));
  }, [
    browser,
    workflows,
    hostRequests,
    request,
    teamApi,
    queryClient,
    queryScope,
    directory,
    directoryRefresh,
    refreshHosts,
    refreshMemberships,
    reorderServers,
    applySidebarLayout,
    channelStore,
    conversationStore,
    liveState,
    sendApproval,
    hostedServerStarting,
    forgetServer,
    loadConversation,
    loadConversationAround,
    loadLatestMessages,
    loadOlderMessages,
    markAgentRead,
    markAllRead,
    updatePreferences,
    changeHostHidden,
  ]);

  const activeServer = useMemo(
    () => servers.find((server) => server.id === activeServerId) ?? EMPTY_SERVER,
    [servers, activeServerId],
  );
  const activeServerHasPreferences = Boolean(preferences[activeServer.id]);
  const activeAgents = useMemo(
    () =>
      activeServerHasPreferences
        ? agents.filter((agent) => agent.serverId === activeServer.id && !hiddenAgentIds.includes(agent.id))
        : NO_AGENTS,
    [activeServerHasPreferences, agents, activeServer.id, hiddenAgentIds],
  );
  const hiddenAgents = useMemo(
    () => agents.filter((agent) => agent.serverId === activeServer.id && hiddenAgentIds.includes(agent.id)),
    [agents, activeServer.id, hiddenAgentIds],
  );
  const state = useMemo<MobileWorkspaceState>(() => {
    /** An owner or admin of an online host that serves `capability`. The host checks the role again. */
    const administers = (serverId: string, capability: string) => {
      const server = servers.find((candidate) => candidate.id === serverId);
      return Boolean(
        server &&
          showsOnline(server) &&
          canAdministerServer(server.role) &&
          hasCapability(serverCapabilities.current, serverId, capability),
      );
    };
    return {
      ...hostRequests.checks,
      browserViewSupport: browser.browserViewSupport,
      sidebarByServer,
      servers: orderedServers,
      memberCountByServer,
      serverDirectoryState,
      serverDirectoryError,
      agents,
      activeServer,
      activeAgents,
      hiddenAgents,
      pinnedAgentIds,
      pinnedChannelIds,
      pinnedWorkflowIds,
      hiddenChannelIds,
      hidesAgentsOnServer: (serverId) =>
        hostOwnsHide(serverCapabilities.current.get(serverId), servers.find((server) => server.id === serverId)?.role),
      canUnhideAgent: (agentId) =>
        !hostHiddenIds.includes(agentId) ||
        hostOwnsHide(serverCapabilities.current.get(activeServer.id), activeServer.role),
      canEditServerIdentity: (serverId) => administers(serverId, HOST_ADMIN_CAPABILITY),
      canManageServerTimezone: (serverId) => administers(serverId, HOST_TIMEZONE_CAPABILITY),
      canManageAgentMemoryLimit: (serverId) => administers(serverId, AGENT_MEMORY_LIMIT_CAPABILITY),
      canManageServerRoles: (serverId) => administers(serverId, AGENT_ACCESS_CAPABILITY),
      hasAgentAccessLimits: (serverId) => {
        const server = servers.find((candidate) => candidate.id === serverId);
        return Boolean(
          server &&
            showsOnline(server) &&
            !canAdministerServer(server.role) &&
            hasCapability(serverCapabilities.current, serverId, AGENT_ACCESS_CAPABILITY),
        );
      },
      canManageConnectors: (serverId) => administers(serverId, CONNECTORS_CAPABILITY),
      canManageOnePasswordConnector: (serverId) => administers(serverId, ONEPASSWORD_CONNECTOR_CAPABILITY),
      canManageBitwardenConnector: (serverId) => administers(serverId, BITWARDEN_CONNECTOR_CAPABILITY),
      canManageVault: (serverId) => administers(serverId, VAULT_CAPABILITY),
      canImportVault: (serverId) => administers(serverId, VAULT_IMPORT_CAPABILITY),
      canManageVaultApiKeys: (serverId) => administers(serverId, VAULT_V2_CAPABILITY),
      // The same rule as the Updates section of the desktop Server Settings.
      serverUpdateAccess: (serverId) => {
        if (administers(serverId, HOST_UPDATE_CAPABILITY)) return "admin";
        const server = servers.find((candidate) => candidate.id === serverId);
        return server &&
          showsOnline(server) &&
          !canAdministerServer(server.role) &&
          hasCapability(serverCapabilities.current, serverId, HOST_MEMBER_UPDATE_CAPABILITY)
          ? "member"
          : null;
      },
      canReadServerRelease: (serverId) => hasCapability(serverCapabilities.current, serverId, HOST_RELEASE_CAPABILITY),
      canViewHostedSites: (serverId) =>
        servers.some((server) => server.id === serverId && showsOnline(server)) &&
        hasCapability(serverCapabilities.current, serverId, HOSTED_SITES_CAPABILITY),
      canDeleteHostedSites: (serverId) => administers(serverId, HOSTED_SITES_CAPABILITY),
      canManageProviders: (serverId) => administers(serverId, PROVIDERS_ADMIN_CAPABILITY),
      canManageMcpServers: (serverId) => administers(serverId, MCP_SERVERS_CAPABILITY),
      canRelayMcpSignIn: (serverId) =>
        administers(serverId, MCP_SERVERS_CAPABILITY) && administers(serverId, SIGN_IN_RELAY_CAPABILITY),
      canAddMarketplaceAgents: (serverId) => administers(serverId, AGENT_INSTALL_CAPABILITY),
      canUpdateMarketplaceAgents: (serverId) => administers(serverId, AGENT_UPDATE_CAPABILITY),
      canSendNotifications: (serverId) =>
        servers.some((server) => server.id === serverId && showsOnline(server)) && supportsPushNotifications(serverId),
      canManageEvents: (serverId) => administers(serverId, EVENTS_CAPABILITY),
      canManageMissedRuns: (serverId) =>
        administers(serverId, EVENTS_CAPABILITY) && administers(serverId, ROUTINE_RECOVERY_CAPABILITY),
      canManageRoutineResults: (serverId) => administers(serverId, ROUTINE_RESULTS_CAPABILITY),
      canManageAgentSkills: (serverId) => administers(serverId, SKILLS_ADMIN_CAPABILITY),
      canManageSharedTables: (serverId) => administers(serverId, SHARED_TABLES_CAPABILITY),
      canManageAgentAccess: (serverId) => administers(serverId, AGENT_ADMIN_CAPABILITY),
      canManageAgentHostSettings: (serverId) => administers(serverId, AGENT_HOST_SETTINGS_CAPABILITY),
      canPublishAgent: (serverId) => administers(serverId, AGENT_PUBLISH_CAPABILITY),
      canManageProviderAccounts: (serverId) => administers(serverId, PROVIDER_ACCOUNTS_CAPABILITY),
    };
  }, [
    hostRequests,
    browser,
    sidebarByServer,
    orderedServers,
    memberCountByServer,
    serverDirectoryState,
    serverDirectoryError,
    agents,
    servers,
    activeServer,
    activeAgents,
    hiddenAgents,
    pinnedAgentIds,
    pinnedChannelIds,
    pinnedWorkflowIds,
    hiddenChannelIds,
    hostHiddenIds,
    supportsPushNotifications,
  ]);
  const value = useMemo<MobileWorkspaceContextValue>(() => ({ ...state, ...actions }), [state, actions]);

  return (
    <WorkspaceContexts value={value} actions={actions}>
      <RecoveryCountdownContext.Provider value={recoveryCountdowns}>
        <View className="flex-1">
          {children}
          <QuickActionsSync
            apiUrl={session.apiUrl}
            userId={session.user.id}
            servers={servers}
            serversReady={serverDirectoryState === "ready"}
            activeServerId={activeServerId}
            agents={agents}
            preferences={visiblePreferences}
          />
          <ShareExtensionSync
            apiUrl={session.apiUrl}
            userId={session.user.id}
            sessionToken={session.sessionToken}
            servers={orderedServers}
            serversReady={serverDirectoryState === "ready"}
            agents={agents}
          />
          {servers.map((server) => (
            <ServerConnection
              key={server.id}
              hostId={server.id}
              publicKey={server.publicKey}
              active={foreground && (!othersHeld || server.id === activeServerId)}
              directory={directory}
              register={registerConnection}
              load={loadServer}
              onStatus={handleConnectionStatus}
              onMembershipChanged={refreshMemberships}
              onTeamEvent={handleTeamEvent}
            />
          ))}
        </View>
      </RecoveryCountdownContext.Provider>
    </WorkspaceContexts>
  );
}
