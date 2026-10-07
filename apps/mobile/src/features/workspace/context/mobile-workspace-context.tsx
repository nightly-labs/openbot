import {
  type AgentEvent,
  type CreateAgentInput,
  isQueuedMessageReceipt,
  type SidebarLayoutSnapshot,
  type TeamRealtimeEvent,
  type UpdateAgentInput,
} from "@openbot/contracts/ipc";
import { TEAM_API_ROUTES } from "@openbot/contracts/team-api-routes";
import { TEAM_CONVERSATION_UNREAD_CAPABILITY } from "@openbot/contracts/team-protocol/current";
import { EVENTS_CAPABILITY } from "@openbot/contracts/team-protocol/events-v1";
import { HOST_ADMIN_CAPABILITY } from "@openbot/contracts/team-protocol/host-admin-v1";
import { LIVE_ACTIVITY_PUSH_CAPABILITY } from "@openbot/contracts/team-protocol/live-activity-push-v1";
import { SKILLS_ADMIN_CAPABILITY } from "@openbot/contracts/team-protocol/skills-admin-v1";
import { decodeTeamProtocolSupportV1 } from "@openbot/contracts/team-protocol/v1";
import type { TeamProtocolV2Json } from "@openbot/contracts/team-protocol/v2";
import { TEAM_PROTOCOL_V3 } from "@openbot/contracts/team-protocol/v3";
import { sourceText } from "@openbot/i18n/source";
import {
  createRemoteAccountRefresh,
  createRemoteReadRefresh,
  createWorkspacePreferences,
  mergeRemoteUnreadIds,
  type RemoteRecoveryStatus,
  RemoteTeamDirectoryClient,
  type RemoteTeamHost,
  type RemoteWorkspacePreferences,
  readAgentAnalytics,
  runTeamEffect,
} from "@openbot/team-client";
import { createHostedServerWake, WAKE_RECONNECT_DELAY_MS } from "@openbot/team-client/hosted-server-wake";
import type { RemoteFileUpload } from "@openbot/team-client/remote-peer";
import { reconcilePendingRequests } from "@openbot/team-client/runtime-attention";
import { updateHostIdentity } from "@openbot/team-client/team-admin-requests";
import {
  deleteAgent,
  discardAttachmentDraft,
  interruptAgentTurn,
  respondToBrowserSecret,
  respondToBrowserTakeover,
  type TeamApiRequest,
  uploadAttachmentDraft,
} from "@openbot/team-client/team-api-requests";
import { replaceEqualDeep, useQueryClient } from "@tanstack/react-query";
import { Effect } from "effect";
import * as SecureStore from "expo-secure-store";
import {
  createContext,
  type PropsWithChildren,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { View } from "react-native";
import { showFailureAlert, showWarningAlert } from "@/features/analytics/failure-reports";
import { mobileAnalytics } from "@/features/analytics/mobile-analytics";
import { trackWorkspaceActions } from "@/features/analytics/workspace-actions";
import { useMobileSession } from "@/features/auth/context/mobile-session-context";
import { MobileChannelStore } from "@/features/channels/model/channel-store";
import { useLiveActivity } from "@/features/live-activity/use-live-activity";
import { fetch } from "@/features/support/model/logged-fetch";
import { supportLog } from "@/features/support/model/support-log";
import type { RemoteTeamTransportRef } from "@/features/workspace/components/remote-team-transport";
import {
  ServerConnection,
  type ServerConnectionHandle,
  type ServerLoadContext,
} from "@/features/workspace/components/server-connection";
import { createHostRequestActions, requestAgentAvatar } from "@/features/workspace/context/host-request-actions";
import { reduceAgentActivity } from "@/features/workspace/model/agent-activity";
import {
  canToggleAgentPin,
  reconcileAgentPins,
  reconcileChannelPins,
  setChannelHidden,
} from "@/features/workspace/model/agent-pins";
import { conversationMessageId, decodeConversationPage } from "@/features/workspace/model/conversation";
import { MobileConversationStore } from "@/features/workspace/model/conversation-store";
import { LiveWorkspaceStore } from "@/features/workspace/model/live-workspace-store";
import { applyMobileQueueEvent } from "@/features/workspace/model/queue-cache";
import { decodeServerOrder, serverAccent, serverOrderKey, sortServers } from "@/features/workspace/model/server-order";
import { applyServerRecovery, serverKind } from "@/features/workspace/model/server-status";
import { trustedHostKeys } from "@/features/workspace/model/trusted-host-keys";
import {
  decodeAgent,
  decodeAgentSummaries,
  decodeConversationReads,
  decodeSidebarLayout,
  ignoreResponse,
  projectAgent,
  type RemoteAgent,
  updateAgentPayload,
} from "@/features/workspace/model/workspace-records";
import type {
  MobileAgent,
  MobileServer,
  MobileServerDirectoryState,
  MobileWorkspaceContextValue,
} from "@/features/workspace/model/workspace-types";
import { currentText } from "@/shared/lib/text";
import { useAppForeground } from "@/shared/lib/use-app-foreground";

export type {
  MobileAgent,
  MobileServer,
  MobileServerDirectoryState,
  MobileWorkspaceContextValue,
} from "@/features/workspace/model/workspace-types";

const NO_IDS: string[] = [];
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

const MobileWorkspaceContext = createContext<MobileWorkspaceContextValue | null>(null);

export function MobileWorkspaceProvider({ children }: PropsWithChildren) {
  const { session, sessionScope } = useMobileSession();
  const queryClient = useQueryClient();
  useEffect(() => () => queryClient.removeQueries({ queryKey: ["chat-queue"] }), [queryClient]);
  const presenceSignatures = useRef(new Map<string, string>());
  if (!session) throw new Error("MobileWorkspaceProvider requires a signed-in mobile session.");

  const directory = useMemo(
    () =>
      new RemoteTeamDirectoryClient({
        apiUrl: session.apiUrl,
        token: session.sessionToken,
        fetch,
        hostKeys: trustedHostKeys(session.apiUrl, session.user.id),
        pairedHost: session.host,
      }),
    [session.apiUrl, session.sessionToken, session.user.id, session.host],
  );
  const connections = useRef(new Map<string, ServerConnectionHandle>());
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
  // Keep former agent IDs too, so leaving also removes cached chats of deleted agents.
  const serverAgentIds = useRef(new Map<string, Set<string>>());
  const removedServers = useRef(new Set<string>());
  const readRefresh = useMemo(() => createRemoteReadRefresh(), []);
  const serverCapabilities = useRef(new Map<string, string[]>());
  const [activeServerId, setActiveServerId] = useState<string | null>(session.host?.hostId ?? null);
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
        get: (key) => SecureStore.getItem(key),
        set: (key, value) =>
          SecureStore.setItem(key, value, { keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY }),
      }),
    [session.apiUrl, session.user.id],
  );
  const [preferences, setPreferences] = useState<Record<string, RemoteWorkspacePreferences>>({});
  const orderKey = serverOrderKey(session.apiUrl, session.user.id);
  const storedServerOrder = useMemo(() => {
    try {
      return decodeServerOrder(SecureStore.getItem(orderKey));
    } catch {
      return [];
    }
  }, [orderKey]);
  const [savedServerOrder, setSavedServerOrder] = useState<{ key: string; ids: string[] } | null>(null);
  const serverOrder = savedServerOrder?.key === orderKey ? savedServerOrder.ids : storedServerOrder;
  const orderedServers = useMemo(() => sortServers(servers, serverOrder), [servers, serverOrder]);
  const preferencesRef = useRef(preferences);
  preferencesRef.current = preferences;
  const hiddenAgentIds = (activeServerId ? preferences[activeServerId]?.hidden : null) ?? NO_IDS;
  const pinnedAgentIds = (activeServerId ? preferences[activeServerId]?.pinned : null) ?? NO_IDS;
  const hiddenChannelIds = (activeServerId ? preferences[activeServerId]?.hiddenChannels : null) ?? NO_IDS;
  const pinnedChannelIds = (activeServerId ? preferences[activeServerId]?.pinnedChannels : null) ?? NO_IDS;
  const readWrites = useRef(new Map<string, Promise<void>>());
  /** Applies host read state. The Live Activity also shows the message counts. */
  const applyConversationReads = useCallback(
    (reads: Record<string, { unreadCount: number }>) => {
      liveState.update("unreadAgentIds", (current) => mergeRemoteUnreadIds(current, reads));
      liveState.update("unreadCounts", (current) => ({
        ...current,
        ...Object.fromEntries(Object.entries(reads).map(([agentId, read]) => [agentId, read.unreadCount])),
      }));
    },
    [liveState],
  );

  const installHosts = useCallback(
    (hosts: RemoteTeamHost[]) => {
      const available = new Set(hosts.map((host) => host.hostId));
      const removed = serversRef.current.filter((server) => !available.has(server.id));
      const removedAgentIds = new Set<string>();
      for (const server of removed) {
        removedServers.current.add(server.id);
        readRefresh.invalidate(server.id);
        for (const id of serverAgentIds.current.get(server.id) ?? []) removedAgentIds.add(id);
        serverAgentIds.current.delete(server.id);
        presenceSignatures.current.delete(server.id);
        queryClient.removeQueries({ queryKey: ["chat-queue", server.id] });
        for (const kind of ["server-members", "server-invites", "agent-avatar", "server-logo"]) {
          queryClient.removeQueries({ queryKey: [kind, session.apiUrl, session.user.id, sessionScope, server.id] });
        }
      }
      for (const host of hosts) removedServers.current.delete(host.hostId);
      if (removed.length) {
        setSidebarByServer((current) =>
          Object.fromEntries(Object.entries(current).filter(([id]) => available.has(id))),
        );
        setAgents((current) => current.filter((agent) => available.has(agent.serverId)));
        for (const id of removedAgentIds) conversationStore.remove(id);
        liveState.update("unreadAgentIds", (current) => current.filter((id) => !removedAgentIds.has(id)));
        liveState.update("activityByServer", (current) =>
          Object.fromEntries(Object.entries(current).filter(([id]) => available.has(id))),
        );
      }
      setServers((current) => {
        const previousServers = new Map(current.map((server) => [server.id, server]));
        return hosts.map((host) => {
          const previous = previousServers.get(host.hostId);
          return {
            id: host.hostId,
            name: host.name,
            logoKey: host.logoKey,
            kind: serverKind(host.hostId, session.host?.hostId),
            state: previous?.state ?? "unknown",
            initialConnectionPending: previous?.initialConnectionPending ?? true,
            connectionMessage: previous?.connectionMessage ?? null,
            recoveryStatus: previous?.recoveryStatus,
            address: null,
            accent: serverAccent(host.hostId),
            publicKey: previous?.publicKey ?? host.devicePublicKey,
            membershipId: host.membershipId,
            role: host.role,
            ...(host.memberLimit === undefined ? {} : { memberLimit: host.memberLimit }),
          };
        });
      });
      setActiveServerId((current) => (hosts.some((host) => host.hostId === current) ? current : null));
    },
    [
      liveState,
      session.host?.hostId,
      session.apiUrl,
      session.user.id,
      sessionScope,
      queryClient,
      readRefresh,
      conversationStore,
    ],
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
      const client = serverId ? connections.current.get(serverId)?.client : null;
      if (!client) throw new Error(currentText().t("mobile.workspace.error.transportNotReady"));
      return client.request(method, path, decode, body, upload, onUploadProgress);
    },
    [],
  );
  const loadAgentAvatar = useCallback(
    (agentId: string, avatarUrl: string, serverId: string) => requestAgentAvatar(request, agentId, avatarUrl, serverId),
    [request],
  );
  const postLiveActivityAction = useCallback(
    (serverId: string, path: string, body: TeamProtocolV2Json) => request("POST", path, ignoreResponse, body, serverId),
    [request],
  );
  const supportsLiveActivityPush = useCallback(
    (serverId: string) => serverCapabilities.current.get(serverId)?.includes(LIVE_ACTIVITY_PUSH_CAPABILITY) === true,
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
          void queryClient.invalidateQueries({
            predicate: (query) => query.queryKey[0] === "server-routines" && query.queryKey[4] === serverId,
          });
        const pinned = preferencesRef.current[serverId]?.pinnedChannels;
        if (!pinned?.length) return;
        const available = new Set(channels.map((channel) => channel.id));
        if (pinned.every((id) => available.has(id))) return;
        try {
          const saved = reconcileChannelPins(preferenceStore, serverId, channels);
          setPreferences((current) => ({ ...current, [serverId]: saved }));
        } catch {
          showFailureAlert(
            undefined,
            "settings",
            currentText().t("mobile.workspace.alert.preferencesTitle"),
            currentText().t("mobile.workspace.alert.preferencesBody"),
          );
        }
      }),
    [request, preferenceStore, queryClient],
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
      } catch {
        showFailureAlert(
          undefined,
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

  const loadServer = useCallback(
    async (serverId: string, publicKey: string, client: RemoteTeamTransportRef, context: ServerLoadContext) => {
      // Runtime events and snapshots own activity; workspace reads must preserve it.
      context.stage = "preferences";
      const saved = preferenceStore.read(serverId);
      setPreferences((current) => ({ ...current, [serverId]: saved }));
      context.stage = "connection";
      await client.connect(serverId, publicKey);
      if (!context.isCurrent()) return;
      context.stage = "compatibility";
      const compatibility = await client.request("GET", TEAM_API_ROUTES.compatibility, decodeTeamProtocolSupportV1);
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
      if (compatibility.capabilities.includes("sidebar-layout")) {
        try {
          const layout = await client.request("GET", TEAM_API_ROUTES.sidebarLayout.state, decodeSidebarLayout);
          if (!context.isCurrent()) return;
          applySidebarLayout(serverId, layout);
        } catch (error) {
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
        }
      } else {
        setSidebarByServer((current) => ({ ...current, [serverId]: { layout: null, error: null } }));
      }
      context.stage = "agents";
      const summaries = await client.request("GET", TEAM_API_ROUTES.agents.all, decodeAgentSummaries);
      if (!context.isCurrent()) return;
      replaceServerAgents(serverId, summaries);
      context.stage = "reads";
      await runTeamEffect(
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
      if (!context.isCurrent()) return;
      context.stage = "conversations";
      const ordered = [...summaries].sort(
        (a, b) => Number(conversationStore.isObserved(b.id)) - Number(conversationStore.isObserved(a.id)),
      );
      for (const agent of ordered) {
        if (!context.isCurrent()) return;
        if (!conversationStore.get(agent.id)) continue;
        await conversationStore.loadLatest(
          agent.id,
          () =>
            client.request(
              "GET",
              `${TEAM_API_ROUTES.agent.conversationPage(agent.id)}?limit=50`,
              decodeConversationPage,
            ),
          context.isCurrent,
          true,
        );
      }
      context.stage = "connection";
    },
    [
      replaceServerAgents,
      preferenceStore,
      readRefresh,
      conversationStore,
      channelStore,
      applySidebarLayout,
      applyConversationReads,
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
  const wakeReconnect = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  useEffect(() => () => clearTimeout(wakeReconnect.current), []);
  // A hosted server that stopped for no use starts again only for use: the selected server, with the
  // app in the foreground. It connects again when the account server says that it starts.
  const wakeSelectedServer = useCallback(
    (hostId: string) => {
      if (!foregroundRef.current || hostId !== activeServerIdRef.current) return;
      void runTeamEffect(wakeHostedServer(hostId)).then((waking) => {
        if (!waking || hostId !== activeServerIdRef.current) return;
        clearTimeout(wakeReconnect.current);
        wakeReconnect.current = setTimeout(() => connections.current.get(hostId)?.refresh(), WAKE_RECONNECT_DELAY_MS);
      });
    },
    [wakeHostedServer],
  );
  /** The last failed attempt of each server that asked for a wake. */
  const wakeAttempts = useRef(new Map<string, number>());
  const handleConnectionStatus = useCallback(
    (hostId: string, status: RemoteRecoveryStatus, failure: string | null) => {
      setServers((current) =>
        current.map((server) => (server.id === hostId ? applyServerRecovery(server, status, failure) : server)),
      );
      // The status repeats each second while it waits, so each failed attempt asks once.
      if (status.phase === "online") wakeAttempts.current.delete(hostId);
      if (status.phase !== "waiting" && status.phase !== "cooldown") return;
      if (wakeAttempts.current.get(hostId) === status.attempt) return;
      wakeAttempts.current.set(hostId, status.attempt);
      wakeSelectedServer(hostId);
    },
    [wakeSelectedServer],
  );
  // The next retry of an offline server can be two minutes away, so a server starts when it is selected.
  useEffect(() => {
    if (!foreground || !activeServerId) return;
    if (serversRef.current.find((server) => server.id === activeServerId)?.state === "offline") {
      wakeSelectedServer(activeServerId);
    }
  }, [foreground, activeServerId, wakeSelectedServer]);

  useEffect(() => {
    if (!foreground) {
      loadGeneration.current += 1;
      conversationStore.cancelRequests();
      conversationStore.flush();
    }
    directoryRefresh.setActive(foreground);
  }, [foreground, directoryRefresh, conversationStore]);

  const loadConversation = useCallback(
    async (agentId: string, serverId = activeServerIdRef.current, refresh = false) => {
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
      );
    },
    [request, conversationStore],
  );
  const loadOlderMessages = useCallback(
    async (agentId: string) => {
      const generation = loadGeneration.current;
      const serverId = activeServerIdRef.current;
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

  const refreshConversationReads = useCallback(
    async (serverId = activeServerIdRef.current) => {
      if (!serverId) return;
      await runTeamEffect(
        readRefresh.refresh(
          serverId,
          () =>
            Effect.tryPromise(() =>
              request("GET", TEAM_API_ROUTES.agents.conversationReads, decodeConversationReads, undefined, serverId),
            ),
          applyConversationReads,
          () => !removedServers.current.has(serverId),
        ),
      );
    },
    [request, readRefresh, applyConversationReads],
  );

  const handleTeamEvent = useCallback(
    (serverId: string, event: AgentEvent | TeamRealtimeEvent) => {
      if (removedServers.current.has(serverId)) return;
      applyLiveActivityEvent(serverId, event);
      if (event.type === "runtime-snapshot") {
        liveState.update("browserRequests", (current) => {
          const next = replaceEqualDeep(
            current[serverId],
            reconcilePendingRequests(
              current[serverId] ?? [],
              event.snapshot.pendingBrowserTakeovers,
              event.snapshot.attentionComplete,
            ),
          );
          return next === current[serverId] ? current : { ...current, [serverId]: next };
        });
      } else if (event.type === "browser-takeover-requested") {
        liveState.update("browserRequests", (current) => ({
          ...current,
          [serverId]: [
            ...(current[serverId] ?? []).filter((item) => item.requestId !== event.request.requestId),
            event.request,
          ],
        }));
      } else if (event.type === "browser-takeover-resolved") {
        liveState.update("browserRequests", (current) => ({
          ...current,
          [serverId]: (current[serverId] ?? []).filter((item) => item.requestId !== event.requestId),
        }));
      }
      if (event.type === "sidebar-layout-changed") {
        applySidebarLayout(serverId, event.layout);
        return;
      }
      if (event.type === "queue-changed" || event.type === "queue-invalidated") {
        void applyMobileQueueEvent(queryClient, serverId, event);
      }
      if (
        event.type === "routines-changed" ||
        event.type === "channel-routines-changed" ||
        event.type === "agents-changed" ||
        // A routine run ends as a turn: its slot changes from planned to its outcome.
        (event.type === "turn-completed" && event.origin === "routine")
      ) {
        void queryClient.invalidateQueries({
          queryKey: ["server-routines", session.apiUrl, session.user.id, sessionScope, serverId],
        });
        // Webhook history: a host also sends a routine change when it ignores a request.
        void queryClient.invalidateQueries({ queryKey: ["routine-webhooks", serverId] });
      }
      if (
        event.type === "channels-changed" ||
        event.type === "channel-memories-changed" ||
        event.type === "channel-routines-changed"
      ) {
        if (event.type === "channels-changed") void channelStore.refresh(serverId, event.channelId);
        void queryClient.invalidateQueries({
          queryKey: [
            "channel-info",
            session.apiUrl,
            session.user.id,
            sessionScope,
            serverId,
            event.channelId,
            ...(event.type === "channel-memories-changed"
              ? ["memories"]
              : event.type === "channel-routines-changed"
                ? ["routines"]
                : []),
          ],
          // Message streaming also emits channels-changed. Only settings events need an immediate settings read.
          refetchType: event.type === "channels-changed" ? "none" : "active",
        });
        return;
      }
      if (event.type === "team-presence") {
        const signature = JSON.stringify(
          event.snapshot.members.map((member) => [member.id, member.role, member.disabled, member.online]),
        );
        if (presenceSignatures.current.get(serverId) !== signature) {
          presenceSignatures.current.set(serverId, signature);
          for (const kind of ["server-members", "server-invites"]) {
            void queryClient.invalidateQueries({
              queryKey: [kind, session.apiUrl, session.user.id, sessionScope, serverId],
            });
          }
        }
        return;
      }
      if (
        event.type !== "conversation" ||
        event.snapshot.revision >= (conversationStore.get(event.snapshot.agentId)?.revision ?? 0)
      ) {
        liveState.update("activityByServer", (current) => {
          const previous = current[serverId] ?? {};
          const next = reduceAgentActivity(previous, event);
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
      if (
        event.type === "memories-changed" ||
        event.type === "routines-changed" ||
        event.type === "skills-changed" ||
        event.type === "turn-completed"
      ) {
        void queryClient.invalidateQueries({
          queryKey: ["agent-info", session.apiUrl, session.user.id, sessionScope, serverId, event.agentId],
        });
      }
      if (event.type === "agents-changed") {
        replaceServerAgents(serverId, event.agents);
        // Access and auto-approve are not in the agent summary; the host sends this event when either changes.
        void queryClient.invalidateQueries({
          queryKey: ["agent-info", session.apiUrl, session.user.id, sessionScope, serverId],
          predicate: (query) => query.queryKey.at(-1) === "admin",
        });
      } else if (event.type === "conversation") {
        const knownIds = serverAgentIds.current.get(serverId) ?? new Set<string>();
        knownIds.add(event.snapshot.agentId);
        serverAgentIds.current.set(serverId, knownIds);
        if (conversationStore.get(event.snapshot.agentId))
          void loadConversation(event.snapshot.agentId, serverId, true).catch(() => undefined);
      } else if (event.type === "conversation-delta") {
        conversationStore.enqueue(event);
      } else if (event.type === "conversation-page") {
        const readState = event.page.readState;
        if (readState) {
          readRefresh.invalidate(serverId);
          applyConversationReads({ [event.page.agentId]: readState });
        } else void refreshConversationReads(serverId).catch(() => undefined);
        if (conversationStore.get(event.page.agentId)) conversationStore.applyPage(event.page);
      } else if (event.type === "conversation-invalidated" || event.type === "turn-completed") {
        if (conversationStore.get(event.agentId))
          void loadConversation(event.agentId, serverId, true).catch(() => undefined);
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
      loadConversation,
      replaceServerAgents,
      conversationStore,
      refreshConversationReads,
      readRefresh,
      queryClient,
      session.apiUrl,
      session.user.id,
      sessionScope,
      applyConversationReads,
    ],
  );

  const markAgentRead = useCallback(
    (agentId: string, visibleMessageId?: string | null) => {
      if (
        visibleMessageId === null &&
        (!activeServerId ||
          !serverCapabilities.current.get(activeServerId)?.includes(TEAM_CONVERSATION_UNREAD_CAPABILITY))
      ) {
        showWarningAlert(
          "team",
          currentText().t("mobile.workspace.alert.updateRequiredTitle"),
          currentText().t("mobile.workspace.alert.updateRequiredUnread"),
        );
        return;
      }
      if (!activeServerId) return;
      const isCurrentRead = readRefresh.invalidate(activeServerId);
      const generation = loadGeneration.current;
      liveState.update("unreadAgentIds", (current) =>
        visibleMessageId === null ? [...new Set([...current, agentId])] : current.filter((id) => id !== agentId),
      );
      const write = (readWrites.current.get(agentId) ?? Promise.resolve())
        .then(async () => {
          if (generation !== loadGeneration.current) return;
          const snapshot =
            visibleMessageId !== undefined
              ? null
              : (conversationStore.get(agentId) ?? (await loadConversation(agentId)));
          if (generation !== loadGeneration.current) return;
          const throughMessageId = visibleMessageId !== undefined ? visibleMessageId : snapshot?.messages.at(-1)?.id;
          if (throughMessageId === undefined) return;
          const reads = await request(
            "POST",
            visibleMessageId === null
              ? TEAM_API_ROUTES.agent.conversationUnread(agentId)
              : TEAM_API_ROUTES.agent.conversationRead(agentId),
            (value) => decodeConversationReads({ [agentId]: value }),
            visibleMessageId === null ? {} : { throughMessageId },
          );
          if (generation === loadGeneration.current && isCurrentRead()) {
            readRefresh.invalidate(activeServerId);
            applyConversationReads(reads);
          }
        })
        .catch(() => {
          if (generation === loadGeneration.current) void refreshConversationReads().catch(() => undefined);
          if (visibleMessageId === null)
            showFailureAlert(
              undefined,
              "settings",
              currentText().t("mobile.workspace.alert.markUnreadTitle"),
              currentText().t("mobile.workspace.alert.markUnreadBody"),
            );
        });
      readWrites.current.set(agentId, write);
      void write.finally(() => {
        if (readWrites.current.get(agentId) === write) readWrites.current.delete(agentId);
      });
    },
    [
      liveState,
      request,
      refreshConversationReads,
      loadConversation,
      activeServerId,
      readRefresh,
      conversationStore,
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
      } catch {
        showFailureAlert(
          undefined,
          "settings",
          currentText().t("mobile.workspace.alert.preferencesTitle"),
          currentText().t("mobile.workspace.alert.preferencesBody"),
        );
        return null;
      }
    },
    [preferenceStore],
  );

  const value = useMemo<MobileWorkspaceContextValue>(() => {
    const activeServer = servers.find((server) => server.id === activeServerId) ?? EMPTY_SERVER;
    /** An owner or admin of an online host that serves `capability`. The host checks the role again. */
    const administers = (serverId: string, capability: string) => {
      const server = servers.find((candidate) => candidate.id === serverId);
      return Boolean(
        server &&
          server.state === "online" &&
          (server.role === "owner" || server.role === "admin") &&
          serverCapabilities.current.get(serverId)?.includes(capability),
      );
    };
    const workspace: MobileWorkspaceContextValue = {
      sidebarByServer,
      mutateSidebarLayout: async (serverId, action) => {
        if (!serverCapabilities.current.get(serverId)?.includes("sidebar-layout")) {
          throw new Error(currentText().t("mobile.workspace.error.sectionsUnsupported"));
        }
        const layout = await request(
          "POST",
          TEAM_API_ROUTES.sidebarLayout.actions,
          decodeSidebarLayout,
          action,
          serverId,
        );
        applySidebarLayout(serverId, layout);
      },
      channelStore,
      servers: orderedServers,
      reorderServers: (serverIds) => {
        try {
          SecureStore.setItem(orderKey, JSON.stringify(serverIds), {
            keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY,
          });
          setSavedServerOrder({ key: orderKey, ids: serverIds });
          return true;
        } catch {
          showFailureAlert(
            undefined,
            "settings",
            currentText().t("mobile.workspace.alert.serverOrderTitle"),
            currentText().t("mobile.workspace.alert.serverOrderBody"),
          );
          return false;
        }
      },
      teamDirectory: directory,
      serverDirectoryState,
      serverDirectoryError,
      agents,
      activeServer,
      activeAgents: preferences[activeServer.id]
        ? agents.filter((agent) => agent.serverId === activeServer.id && !hiddenAgentIds.includes(agent.id))
        : [],
      hiddenAgents: agents.filter((agent) => agent.serverId === activeServer.id && hiddenAgentIds.includes(agent.id)),
      pinnedAgentIds,
      pinnedChannelIds,
      hiddenChannelIds,
      hideChannel: (id, serverId) =>
        Boolean(updatePreferences(serverId, (current) => setChannelHidden(current, id, true))),
      unhideChannel: (id, serverId) =>
        Boolean(updatePreferences(serverId, (current) => setChannelHidden(current, id, false))),
      conversationStore,
      liveState,
      respondToBrowserTakeover: (serverId, input) =>
        Effect.runPromise(
          respondToBrowserTakeover(teamApi(serverId), input).pipe(Effect.mapError((error) => error.cause)),
        ),
      respondToBrowserSecret: (serverId, input) =>
        Effect.runPromise(
          respondToBrowserSecret(teamApi(serverId), input).pipe(Effect.mapError((error) => error.cause)),
        ),
      selectServer: (id) => {
        loadGeneration.current += 1;
        conversationStore.cancelRequests();
        setActiveServerId(id);
      },
      leaveServer: async (serverId) => {
        const server = serversRef.current.find((candidate) => candidate.id === serverId);
        if (!server || server.role === "owner")
          throw new Error(currentText().t("mobile.workspace.error.leaveOwnServer"));
        await runTeamEffect(directory.leaveHost(server.id, server.membershipId));
        removedServers.current.add(serverId);
        readRefresh.invalidate(serverId);
        directoryGeneration.current += 1;
        directoryRefresh.invalidate();
        setServerDirectoryState("ready");
        setServerDirectoryError(null);
        const removedIds = serverAgentIds.current.get(serverId) ?? new Set<string>();
        serverAgentIds.current.delete(serverId);
        if (activeServerId === serverId) {
          loadGeneration.current += 1;
          setActiveServerId(session.host?.hostId ?? null);
        }
        setServers((current) => current.filter((candidate) => candidate.id !== serverId));
        setSidebarByServer((current) => Object.fromEntries(Object.entries(current).filter(([id]) => id !== serverId)));
        setAgents((current) => current.filter((agent) => agent.serverId !== serverId));
        liveState.update("activityByServer", (current) => {
          const next = { ...current };
          delete next[serverId];
          return next;
        });
        for (const id of removedIds) conversationStore.remove(id);
        updatePreferences(serverId, () => ({ hidden: [], pinned: [] }));
        liveState.update("unreadAgentIds", (current) => current.filter((id) => !removedIds.has(id)));
      },
      refreshServer: async (serverId) => {
        connections.current.get(serverId)?.refresh();
        await refreshHosts();
      },
      canEditServerIdentity: (serverId) => administers(serverId, HOST_ADMIN_CAPABILITY),
      canManageEvents: (serverId) => administers(serverId, EVENTS_CAPABILITY),
      canManageAgentSkills: (serverId) => administers(serverId, SKILLS_ADMIN_CAPABILITY),
      updateServerIdentity: async (serverId, input) => {
        const server = serversRef.current.find((candidate) => candidate.id === serverId);
        if (!server || server.role === "member")
          throw new Error(currentText().t("mobile.server.settings.identityNotAllowed"));
        if (!serverCapabilities.current.get(serverId)?.includes(HOST_ADMIN_CAPABILITY))
          throw new Error(currentText().t("mobile.server.settings.identityUnsupported"));
        await runTeamEffect(updateHostIdentity(teamApi(serverId), input).pipe(Effect.mapError((error) => error.cause)));
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
          {
            id: host.hostId,
            name: host.name,
            logoKey: host.logoKey,
            kind: "remote",
            state: "unknown",
            initialConnectionPending: true,
            connectionMessage: null,
            address: null,
            accent: serverAccent(host.hostId),
            publicKey: host.devicePublicKey,
            membershipId: host.membershipId,
            role: host.role,
            ...(host.memberLimit === undefined ? {} : { memberLimit: host.memberLimit }),
          },
        ]);
        setActiveServerId(host.hostId);
        // Membership is already committed. Directory failure must not reuse the consumed invite.
        void refreshHosts().catch(() => undefined);
        return host.hostId;
      },
      ...createHostRequestActions({
        request,
        teamApi,
        queryClient,
        queryScope: [session.apiUrl, session.user.id, sessionScope],
        capabilities: serverCapabilities.current,
        attachmentDownloads,
      }),
      loadAgentAnalytics: async (input, serverId) => {
        if (!agents.some((agent) => agent.id === input.agentId && agent.serverId === serverId))
          throw new Error(currentText().t("mobile.workspace.error.agentNotOnHost"));
        return runTeamEffect(
          readAgentAnalytics(
            (method, path, decode) => request(method, path, decode, undefined, serverId),
            serverCapabilities.current.get(serverId) ?? [],
            input,
          ).pipe(Effect.mapError((error) => error.cause)),
        );
      },
      createAgent: async (input: CreateAgentInput) => {
        const created = await request("POST", TEAM_API_ROUTES.agents.all, decodeAgent, {
          name: input.name,
          description: input.description,
          avatarSeed: input.avatarSeed,
          avatarHue: input.avatarHue,
          initialMessage: input.initialMessage,
        });
        setAgents((current) => [
          ...current.filter((agent) => agent.id !== created.id),
          projectAgent(activeServer.id, created),
        ]);
      },
      updateAgent: async (input: UpdateAgentInput, serverId = activeServerIdRef.current ?? undefined) => {
        if (!serverId || !agents.some((agent) => agent.id === input.agentId && agent.serverId === serverId))
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
        if (!agents.some((agent) => agent.id === agentId && agent.serverId === serverId))
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
            ["agent-avatar", session.apiUrl, session.user.id, sessionScope, serverId, agentId, updated.avatarUrl],
            `data:${image.mimeType};base64,${image.base64}`,
          );
        }
        setAgents((current) =>
          current.map((agent) =>
            agent.id === updated.id && agent.serverId === serverId ? projectAgent(serverId, updated) : agent,
          ),
        );
      },
      deleteAgent: (agentId) =>
        Effect.runPromise(deleteAgent(teamApi(), agentId).pipe(Effect.mapError((error) => error.cause))),
      interruptTurn: (agentId, turnId, serverId) =>
        Effect.runPromise(
          interruptAgentTurn(teamApi(serverId), agentId, turnId).pipe(Effect.mapError((error) => error.cause)),
        ),
      loadConversation,
      loadOlderMessages,
      uploadAttachment: async (agentId, input, targetServerId, onProgress) => {
        const serverId = targetServerId ?? agents.find((candidate) => candidate.id === agentId)?.serverId;
        if (!serverId) throw new Error(currentText().t("mobile.workspace.error.agentUnavailable"));
        return Effect.runPromise(
          uploadAttachmentDraft(teamApi(serverId, onProgress), input).pipe(Effect.mapError((error) => error.cause)),
        );
      },
      discardAttachment: async (agentId, attachmentId, targetServerId) => {
        const serverId = targetServerId ?? agents.find((candidate) => candidate.id === agentId)?.serverId;
        if (!serverId) throw new Error(currentText().t("mobile.workspace.error.agentUnavailable"));
        await Effect.runPromise(
          discardAttachmentDraft(teamApi(serverId), attachmentId).pipe(Effect.mapError((error) => error.cause)),
        );
      },
      sendMessage: async (agentId, text, attachmentDraftIds = [], replyToMessageId = null, targetServerId) => {
        const serverId = targetServerId ?? agents.find((candidate) => candidate.id === agentId)?.serverId;
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
          },
          serverId,
        );
        return conversationMessageId(receipt, agentId);
      },
      respondToPrompt: async (agentId, input) => {
        const agent = agents.find((candidate) => candidate.id === agentId);
        const snapshot = conversationStore.get(agentId);
        const message = snapshot?.messages.find(
          (item) =>
            item.turnId === snapshot.activeTurnId &&
            item.questionPrompt?.requestId === input.requestId &&
            item.questionPrompt.resolution === null,
        );
        if (
          agent?.serverId !== activeServer.id ||
          activeServer.state !== "online" ||
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
        const saved = updatePreferences(activeServer.id, (current) => ({
          ...current,
          hidden: [...new Set([...current.hidden, agentId])],
          pinned: current.pinned.filter((id) => id !== agentId),
        }));
        mobileAnalytics.track("conversation_action", { action: "hide", result: saved ? "succeeded" : "failed" });
      },
      unhideAgent: (agentId) => {
        const saved = updatePreferences(activeServer.id, (current) => ({
          ...current,
          hidden: current.hidden.filter((id) => id !== agentId),
        }));
        mobileAnalytics.track("conversation_action", { action: "unhide", result: saved ? "succeeded" : "failed" });
      },
      markAgentRead,
      markAgentUnread: (agentId) => {
        markAgentRead(agentId, null);
      },
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
      toggleAgentPin: (agentId) => {
        if (!canToggleAgentPin([...pinnedAgentIds, ...pinnedChannelIds], agentId)) return "error";
        if (pinnedAgentIds.includes(agentId)) {
          return updatePreferences(activeServer.id, (current) => ({
            ...current,
            pinned: current.pinned.filter((id) => id !== agentId),
          }))
            ? "unpinned"
            : "error";
        }
        return updatePreferences(activeServer.id, (current) => ({
          ...current,
          pinned: [...new Set([...current.pinned, agentId])],
        }))
          ? "pinned"
          : "error";
      },
    };
    return trackWorkspaceActions(workspace);
  }, [
    sidebarByServer,
    applySidebarLayout,
    channelStore,
    activeServerId,
    agents,
    conversationStore,
    directory,
    directoryRefresh,
    hiddenAgentIds,
    loadConversation,
    loadOlderMessages,
    markAgentRead,
    pinnedAgentIds,
    pinnedChannelIds,
    hiddenChannelIds,
    refreshHosts,
    refreshMemberships,
    readRefresh,
    request,
    serverDirectoryError,
    teamApi,
    serverDirectoryState,
    servers,
    orderedServers,
    orderKey,
    session.host,
    session.apiUrl,
    session.user.id,
    sessionScope,
    queryClient,
    liveState,
    preferences,
    updatePreferences,
  ]);

  return (
    <MobileWorkspaceContext.Provider value={value}>
      <View className="flex-1">
        {children}
        {servers.map((server) => (
          <ServerConnection
            key={server.id}
            hostId={server.id}
            publicKey={server.publicKey}
            active={foreground}
            directory={directory}
            register={registerConnection}
            load={loadServer}
            onStatus={handleConnectionStatus}
            onMembershipChanged={refreshMemberships}
            onTeamEvent={handleTeamEvent}
          />
        ))}
      </View>
    </MobileWorkspaceContext.Provider>
  );
}

export function useMobileWorkspace(): MobileWorkspaceContextValue {
  const value = useContext(MobileWorkspaceContext);
  if (!value) throw new Error("useMobileWorkspace must be used within MobileWorkspaceProvider.");
  return value;
}
