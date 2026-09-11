import {
  type AgentEvent,
  type AgentSummary,
  type CreateAgentInput,
  isAgentMemory,
  isAgentModel,
  isAgentModelOption,
  isAgentProvider,
  isAttachmentSummary,
  isAvatarHue,
  isQueuedMessageReceipt,
  isReasoningEffort,
  isRoutine,
  type TeamRealtimeEvent,
  type UpdateAgentInput,
} from "@openbot/contracts/ipc";
import { isDynamicRecord, isNumber, isString } from "@openbot/contracts/runtime-values";
import { TEAM_API_ROUTES } from "@openbot/contracts/team-api-routes";
import { TEAM_CONVERSATION_UNREAD_CAPABILITY } from "@openbot/contracts/team-protocol/current";
import { decodeTeamProtocolSupportV1 } from "@openbot/contracts/team-protocol/v1";
import type { TeamProtocolV2Json } from "@openbot/contracts/team-protocol/v2";
import { TEAM_PROTOCOL_V3 } from "@openbot/contracts/team-protocol/v3";
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
} from "@openbot/team-client";
import type { RemoteFileUpload } from "@openbot/team-client/remote-peer";
import { userErrorMessage as errorMessage } from "@openbot/user-errors";
import { useQueryClient } from "@tanstack/react-query";
import { fetch } from "expo/fetch";
import * as Crypto from "expo-crypto";
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
import { Alert, View } from "react-native";
import { mobileAnalytics } from "@/features/analytics/mobile-analytics";
import { trackWorkspaceActions } from "@/features/analytics/workspace-actions";
import { useMobileSession } from "@/features/auth/context/mobile-session-context";
import type { RemoteTeamTransportRef } from "@/features/workspace/components/remote-team-transport";
import {
  ServerConnection,
  type ServerConnectionHandle,
  type ServerLoadContext,
} from "@/features/workspace/components/server-connection";
import { type MobileAgentActivities, reduceAgentActivity } from "@/features/workspace/model/agent-activity";
import { canToggleAgentPin } from "@/features/workspace/model/agent-pins";
import { conversationMessageId, decodeConversationPage } from "@/features/workspace/model/conversation";
import { MobileConversationStore } from "@/features/workspace/model/conversation-store";
import { saveAgentRecord } from "@/features/workspace/model/save-agent-record";
import { applyServerRecovery, serverKind } from "@/features/workspace/model/server-status";
import { trustedHostKeys } from "@/features/workspace/model/trusted-host-keys";
import type {
  MobileAgent,
  MobileServer,
  MobileServerDirectoryState,
  MobileWorkspaceContextValue,
} from "@/features/workspace/model/workspace-types";
import { useAppForeground } from "@/shared/lib/use-app-foreground";

export type {
  MobileAgent,
  MobileServer,
  MobileServerDirectoryState,
  MobileServerKind,
  MobileServerState,
  MobileWorkspaceContextValue,
  ToggleAgentPinResult,
} from "@/features/workspace/model/workspace-types";

// Five distinct hues for the server rail, taken from the palette's categorical set
// (--openbot-file-blue/-orange/-teal/-pink and --openbot-success). Hardcoded because
// @openbot/brand ships tokens as CSS only, and these are picked per index in JS.
const SERVER_ACCENTS = ["#74b9ff", "#f0a06a", "#6bc7d9", "#d98ac9", "#31cf76"] as const;
type RemoteAgent = Pick<
  AgentSummary,
  "id" | "name" | "title" | "description" | "preview" | "updatedAt" | "avatarSeed" | "avatarHue"
> &
  Partial<Pick<AgentSummary, "provider" | "model" | "reasoningEffort">>;
const EMPTY_SERVER: MobileServer = {
  id: "unavailable",
  name: "OpenBot",
  kind: "local",
  state: "connecting",
  initialConnectionPending: true,
  connectionMessage: null,
  address: null,
  accent: SERVER_ACCENTS[0],
  publicKey: "",
  membershipId: "",
  role: "member",
};

const MobileWorkspaceContext = createContext<MobileWorkspaceContextValue | null>(null);

export function MobileWorkspaceProvider({ children }: PropsWithChildren) {
  const { session, sessionScope } = useMobileSession();
  const queryClient = useQueryClient();
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
  const [activityByServer, setActivityByServer] = useState<Record<string, MobileAgentActivities>>({});
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
  const hiddenAgentIds = (activeServerId ? preferences[activeServerId]?.hidden : null) ?? [];
  const pinnedAgentIds = (activeServerId ? preferences[activeServerId]?.pinned : null) ?? [];
  const readWrites = useRef(new Map<string, Promise<void>>());
  const [unreadAgentIds, setUnreadAgentIds] = useState<string[]>([]);

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
        for (const kind of ["server-members", "server-invites"]) {
          queryClient.removeQueries({ queryKey: [kind, session.apiUrl, session.user.id, sessionScope, server.id] });
        }
      }
      for (const host of hosts) removedServers.current.delete(host.hostId);
      if (removed.length) {
        setAgents((current) => current.filter((agent) => available.has(agent.serverId)));
        for (const id of removedAgentIds) conversationStore.remove(id);
        setUnreadAgentIds((current) => current.filter((id) => !removedAgentIds.has(id)));
        setActivityByServer((current) =>
          Object.fromEntries(Object.entries(current).filter(([id]) => available.has(id))),
        );
      }
      setServers((current) => {
        const previousServers = new Map(current.map((server) => [server.id, server]));
        return hosts.map((host, index) => {
          const previous = previousServers.get(host.hostId);
          return {
            id: host.hostId,
            name: host.name,
            kind: serverKind(host.hostId, session.host?.hostId),
            state: previous?.state ?? "unknown",
            initialConnectionPending: previous?.initialConnectionPending ?? true,
            connectionMessage: previous?.connectionMessage ?? null,
            recoveryStatus: previous?.recoveryStatus,
            address: null,
            accent: SERVER_ACCENTS[index % SERVER_ACCENTS.length] ?? SERVER_ACCENTS[0],
            publicKey: previous?.publicKey ?? host.devicePublicKey,
            membershipId: host.membershipId,
            role: host.role,
          };
        });
      });
      setActiveServerId((current) => (hosts.some((host) => host.hostId === current) ? current : null));
    },
    [session.host?.hostId, session.apiUrl, session.user.id, sessionScope, queryClient, readRefresh, conversationStore],
  );

  const directoryRefresh = useMemo(
    () =>
      createRemoteAccountRefresh(async () => {
        const generation = ++directoryGeneration.current;
        setServerDirectoryState("loading");
        setServerDirectoryError(null);
        try {
          const hosts = await directory.listHosts();
          if (generation !== directoryGeneration.current) return;
          installHosts(hosts);
          setServerDirectoryState("ready");
        } catch (error) {
          if (generation !== directoryGeneration.current) return;
          setServerDirectoryState("error");
          setServerDirectoryError(errorMessage(error, "The server directory is unavailable."));
          throw error;
        }
      }),
    [directory, installHosts],
  );
  const refreshHosts = useCallback(() => directoryRefresh.refresh(true), [directoryRefresh]);
  const refreshMemberships = useCallback(() => {
    directoryGeneration.current += 1;
    directoryRefresh.invalidate();
    return directoryRefresh.refresh(true);
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
    ): Promise<T> => {
      const client = serverId ? connections.current.get(serverId)?.client : null;
      if (!client) throw new Error("The mobile transport is not ready.");
      return client.request(method, path, decode, body, upload);
    },
    [],
  );

  const replaceServerAgents = useCallback((serverId: string, summaries: RemoteAgent[]) => {
    const knownIds = serverAgentIds.current.get(serverId) ?? new Set<string>();
    for (const agent of summaries) knownIds.add(agent.id);
    serverAgentIds.current.set(serverId, knownIds);
    setAgents((current) => [
      ...current.filter((agent) => agent.serverId !== serverId),
      ...summaries.map((agent) => projectAgent(serverId, agent)),
    ]);
  }, []);

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
      if (compatibility.protocol.minimum > TEAM_PROTOCOL_V3 || compatibility.protocol.maximum < TEAM_PROTOCOL_V3) {
        throw new Error("Update OpenBot Mobile or the desktop app before connecting.");
      }
      serverCapabilities.current.set(serverId, compatibility.capabilities);
      context.stage = "agents";
      const summaries = await client.request("GET", TEAM_API_ROUTES.agents.all, decodeAgentSummaries);
      if (!context.isCurrent()) return;
      replaceServerAgents(serverId, summaries);
      context.stage = "reads";
      await readRefresh.refresh(
        serverId,
        () => client.request("GET", TEAM_API_ROUTES.agents.conversationReads, decodeConversationReads),
        (reads) => setUnreadAgentIds((current) => mergeRemoteUnreadIds(current, reads)),
        () => context.isCurrent() && !removedServers.current.has(serverId),
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
    [replaceServerAgents, preferenceStore, readRefresh, conversationStore],
  );

  const registerConnection = useCallback((hostId: string, handle: ServerConnectionHandle | null) => {
    if (handle) connections.current.set(hostId, handle);
    else connections.current.delete(hostId);
  }, []);
  const handleConnectionStatus = useCallback((hostId: string, status: RemoteRecoveryStatus, failure: string | null) => {
    setServers((current) =>
      current.map((server) => (server.id === hostId ? applyServerRecovery(server, status, failure) : server)),
    );
  }, []);

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
      await readRefresh.refresh(
        serverId,
        () => request("GET", TEAM_API_ROUTES.agents.conversationReads, decodeConversationReads, undefined, serverId),
        (reads) => setUnreadAgentIds((current) => mergeRemoteUnreadIds(current, reads)),
        () => !removedServers.current.has(serverId),
      );
    },
    [request, readRefresh],
  );

  const handleTeamEvent = useCallback(
    (serverId: string, event: AgentEvent | TeamRealtimeEvent) => {
      if (removedServers.current.has(serverId)) return;
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
        setActivityByServer((current) => {
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
      if (event.type === "memories-changed" || event.type === "routines-changed" || event.type === "turn-completed") {
        void queryClient.invalidateQueries({
          queryKey: ["agent-info", session.apiUrl, session.user.id, sessionScope, serverId, event.agentId],
        });
      }
      if (event.type === "agents-changed") replaceServerAgents(serverId, event.agents);
      else if (event.type === "conversation") {
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
          setUnreadAgentIds((current) => mergeRemoteUnreadIds(current, { [event.page.agentId]: readState }));
        } else void refreshConversationReads(serverId).catch(() => undefined);
        if (conversationStore.get(event.page.agentId)) conversationStore.applyPage(event.page);
      } else if (event.type === "conversation-invalidated" || event.type === "turn-completed") {
        if (conversationStore.get(event.agentId))
          void loadConversation(event.agentId, serverId, true).catch(() => undefined);
      } else if (event.type === "team-identity") {
        setServers((current) =>
          current.map((server) => (server.id === serverId ? { ...server, name: event.serverName } : server)),
        );
      }
    },
    [
      loadConversation,
      replaceServerAgents,
      conversationStore,
      refreshConversationReads,
      readRefresh,
      queryClient,
      session.apiUrl,
      session.user.id,
      sessionScope,
    ],
  );

  const markAgentRead = useCallback(
    (agentId: string, visibleMessageId?: string | null) => {
      if (
        visibleMessageId === null &&
        (!activeServerId ||
          !serverCapabilities.current.get(activeServerId)?.includes(TEAM_CONVERSATION_UNREAD_CAPABILITY))
      ) {
        Alert.alert("Update required", "Update this desktop server to mark conversations unread.");
        return;
      }
      if (!activeServerId) return;
      const isCurrentRead = readRefresh.invalidate(activeServerId);
      const generation = loadGeneration.current;
      setUnreadAgentIds((current) =>
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
            setUnreadAgentIds((current) => mergeRemoteUnreadIds(current, reads));
          }
        })
        .catch(() => {
          if (generation === loadGeneration.current) void refreshConversationReads().catch(() => undefined);
          if (visibleMessageId === null) Alert.alert("Could not mark unread", "Reconnect to the server and try again.");
        });
      readWrites.current.set(agentId, write);
      void write.finally(() => {
        if (readWrites.current.get(agentId) === write) readWrites.current.delete(agentId);
      });
    },
    [request, refreshConversationReads, loadConversation, activeServerId, readRefresh, conversationStore],
  );

  const updatePreferences = useCallback(
    (serverId: string, change: (current: RemoteWorkspacePreferences) => RemoteWorkspacePreferences) => {
      try {
        const next = change(preferenceStore.read(serverId));
        preferenceStore.write(serverId, next);
        setPreferences((current) => ({ ...current, [serverId]: next }));
        return next;
      } catch {
        Alert.alert("Could not save chat preferences", "Your previous preferences have been kept. Please try again.");
        return null;
      }
    },
    [preferenceStore],
  );

  const value = useMemo<MobileWorkspaceContextValue>(() => {
    const activeServer = servers.find((server) => server.id === activeServerId) ?? EMPTY_SERVER;
    const workspace: MobileWorkspaceContextValue = {
      servers,
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
      unreadAgentIds,
      conversationStore,
      activityByServer,
      selectServer: (id) => {
        loadGeneration.current += 1;
        conversationStore.cancelRequests();
        setActiveServerId(id);
      },
      leaveServer: async (serverId) => {
        const server = serversRef.current.find((candidate) => candidate.id === serverId);
        if (!server || server.role === "owner") throw new Error("Only joined remote servers can be left.");
        await directory.leaveHost(server.id, server.membershipId);
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
        setAgents((current) => current.filter((agent) => agent.serverId !== serverId));
        setActivityByServer((current) => {
          const next = { ...current };
          delete next[serverId];
          return next;
        });
        for (const id of removedIds) conversationStore.remove(id);
        updatePreferences(serverId, () => ({ hidden: [], pinned: [] }));
        setUnreadAgentIds((current) => current.filter((id) => !removedIds.has(id)));
      },
      refreshServer: async (serverId) => {
        connections.current.get(serverId)?.refresh();
        await refreshHosts();
      },
      refreshServers: async () => {
        for (const connection of connections.current.values()) connection.refresh();
        await refreshHosts();
      },
      addRemoteServer: async ({ inviteUrl }) => {
        const host = await directory.acceptInvite(inviteUrl);
        directoryGeneration.current += 1;
        directoryRefresh.invalidate();
        removedServers.current.delete(host.hostId);
        setServers((current) => [
          ...current.filter((server) => server.id !== host.hostId),
          {
            id: host.hostId,
            name: host.name,
            kind: "remote",
            state: "unknown",
            initialConnectionPending: true,
            connectionMessage: null,
            address: null,
            accent: SERVER_ACCENTS[0],
            publicKey: host.devicePublicKey,
            membershipId: host.membershipId,
            role: host.role,
          },
        ]);
        setActiveServerId(host.hostId);
        // Membership is already committed. Directory failure must not reuse the consumed invite.
        void refreshHosts().catch(() => undefined);
        return host.hostId;
      },
      saveAgentMemory: async (agentId, text, serverId, memoryId) => {
        await saveAgentRecord(
          queryClient,
          ["agent-info", session.apiUrl, session.user.id, sessionScope, serverId, agentId, "memories"],
          () =>
            request(
              memoryId ? "PATCH" : "POST",
              memoryId ? TEAM_API_ROUTES.agent.memory(agentId, memoryId) : TEAM_API_ROUTES.agent.memories(agentId),
              (value) => {
                if (
                  !isAgentMemory(value) ||
                  value.agentId !== agentId ||
                  (memoryId !== undefined && value.id !== memoryId)
                )
                  throw new Error("The host returned an invalid saved record.");
                return value;
              },
              { text },
              serverId,
            ),
        );
      },
      deleteAgentMemory: async (agentId, memoryId, serverId) => {
        await request("DELETE", TEAM_API_ROUTES.agent.memory(agentId, memoryId), ignoreResponse, undefined, serverId);
      },
      createAgentRoutine: async (input, serverId) => {
        await saveAgentRecord(
          queryClient,
          ["agent-info", session.apiUrl, session.user.id, sessionScope, serverId, input.agentId, "routines"],
          () =>
            request(
              "POST",
              TEAM_API_ROUTES.agent.routines(input.agentId),
              (value) => {
                if (!isRoutine(value) || value.agentId !== input.agentId)
                  throw new Error("The host returned an invalid saved record.");
                return value;
              },
              {
                name: input.name,
                instruction: input.instruction,
                active: input.active,
                timezone: input.timezone,
                schedule: input.schedule,
              },
              serverId,
            ),
        );
      },
      updateAgentRoutine: async (input, serverId) => {
        await saveAgentRecord(
          queryClient,
          ["agent-info", session.apiUrl, session.user.id, sessionScope, serverId, input.agentId, "routines"],
          () =>
            request(
              "PATCH",
              TEAM_API_ROUTES.agent.routine(input.agentId, input.routineId),
              (value) => {
                if (!isRoutine(value) || value.agentId !== input.agentId || value.id !== input.routineId)
                  throw new Error("The host returned an invalid saved record.");
                return value;
              },
              {
                ...(input.name === undefined ? {} : { name: input.name }),
                ...(input.instruction === undefined ? {} : { instruction: input.instruction }),
                ...(input.active === undefined ? {} : { active: input.active }),
                ...(input.schedule === undefined ? {} : { schedule: input.schedule }),
              },
              serverId,
            ),
        );
      },
      deleteAgentRoutine: async (agentId, routineId, serverId) => {
        await request("DELETE", TEAM_API_ROUTES.agent.routine(agentId, routineId), ignoreResponse, undefined, serverId);
      },
      loadAgentModels: (serverId) =>
        request(
          "GET",
          TEAM_API_ROUTES.agents.models,
          (value) => {
            if (!Array.isArray(value) || !value.every(isAgentModelOption))
              throw new Error("The host returned invalid models.");
            return value;
          },
          undefined,
          serverId,
        ),
      loadAgentMemories: (agentId, serverId) =>
        request(
          "GET",
          TEAM_API_ROUTES.agent.memories(agentId),
          (value) => {
            if (
              !Array.isArray(value) ||
              !value.every(isAgentMemory) ||
              value.some((memory) => memory.agentId !== agentId)
            )
              throw new Error("The host returned invalid memories.");
            return value;
          },
          undefined,
          serverId,
        ),
      loadAgentRoutines: (agentId, serverId) =>
        request(
          "GET",
          TEAM_API_ROUTES.agent.routines(agentId),
          (value) => {
            if (
              !Array.isArray(value) ||
              !value.every(isRoutine) ||
              value.some((routine) => routine.agentId !== agentId)
            )
              throw new Error("The host returned invalid routines.");
            return value;
          },
          undefined,
          serverId,
        ),
      loadAgentAnalytics: async (input, serverId) => {
        if (!agents.some((agent) => agent.id === input.agentId && agent.serverId === serverId))
          throw new Error("Agent is not on this host.");
        return readAgentAnalytics(
          (method, path, decode) => request(method, path, decode, undefined, serverId),
          serverCapabilities.current.get(serverId) ?? [],
          input,
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
          throw new Error("The agent is unavailable on this host.");
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
      deleteAgent: async (agentId) => {
        await request("DELETE", TEAM_API_ROUTES.agent.one(agentId), ignoreResponse);
      },
      duplicateAgent: async (agentId) => {
        await request("POST", TEAM_API_ROUTES.agent.duplicate(agentId), ignoreResponse, {
          operationId: Crypto.randomUUID(),
        });
      },
      loadConversation,
      loadOlderMessages,
      uploadAttachment: async (agentId, input) => {
        const serverId = agents.find((candidate) => candidate.id === agentId)?.serverId;
        if (!serverId) throw new Error("The agent is unavailable.");
        const query = new URLSearchParams({ name: input.name, mime: input.mimeType });
        return request(
          "POST",
          `${TEAM_API_ROUTES.attachments}?${query}`,
          (value) => {
            if (!isAttachmentSummary(value)) throw new Error("The host returned an invalid attachment.");
            return value;
          },
          undefined,
          serverId,
          input,
        );
      },
      downloadAttachment: (serverId, attachmentId) => {
        const download = () =>
          request(
            "GET",
            TEAM_API_ROUTES.attachment(attachmentId),
            (value) => {
              if (
                !isDynamicRecord(value) ||
                !isString(value.name) ||
                !isString(value.mimeType) ||
                !isString(value.base64)
              )
                throw new Error("The host returned an invalid file.");
              return { name: value.name, mimeType: value.mimeType, base64: value.base64 };
            },
            undefined,
            serverId,
          );
        // Limit native/DOM copies when a message contains several large images.
        const result = attachmentDownloads.current.then(download);
        attachmentDownloads.current = result.then(
          () => {},
          () => {},
        );
        return result;
      },

      discardAttachment: async (agentId, attachmentId) => {
        const serverId = agents.find((candidate) => candidate.id === agentId)?.serverId;
        if (!serverId) throw new Error("The agent is unavailable.");
        await request("DELETE", TEAM_API_ROUTES.attachment(attachmentId), ignoreResponse, undefined, serverId);
      },
      sendMessage: async (agentId, text, attachmentDraftIds = [], replyToMessageId = null) => {
        const serverId = agents.find((candidate) => candidate.id === agentId)?.serverId;
        if (!serverId) throw new Error("The agent is unavailable.");
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
          throw new Error("This form is no longer available.");
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
      toggleAgentPin: (agentId) => {
        if (!canToggleAgentPin(pinnedAgentIds, agentId)) return "error";
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
    activeServerId,
    activityByServer,
    agents,
    conversationStore,
    directory,
    directoryRefresh,
    hiddenAgentIds,
    loadConversation,
    loadOlderMessages,
    markAgentRead,
    pinnedAgentIds,
    refreshHosts,
    readRefresh,
    request,
    serverDirectoryError,
    serverDirectoryState,
    servers,
    session.host,
    session.apiUrl,
    session.user.id,
    sessionScope,
    queryClient,
    unreadAgentIds,
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

function projectAgent(serverId: string, agent: RemoteAgent): MobileAgent {
  return {
    id: agent.id,
    serverId,
    name: agent.name,
    title: agent.title,
    description: agent.description,
    preview: agent.preview,
    updatedLabel: formatUpdatedAt(agent.updatedAt),
    provider: agent.provider,
    model: agent.model,
    reasoningEffort: agent.reasoningEffort,
    avatarSeed: agent.avatarSeed,
    avatarHue: agent.avatarHue,
  };
}

function formatUpdatedAt(value: string | null): string {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  const today = new Date();
  if (date.toDateString() === today.toDateString()) {
    return new Intl.DateTimeFormat(undefined, { hour: "2-digit", minute: "2-digit" }).format(date);
  }
  return new Intl.DateTimeFormat(undefined, { month: "short", day: "numeric" }).format(date);
}

function decodeAgent(value: unknown): RemoteAgent {
  if (
    !isDynamicRecord(value) ||
    !isString(value.id) ||
    !isString(value.name) ||
    !isString(value.title) ||
    !isString(value.description) ||
    !isString(value.preview) ||
    (value.updatedAt !== null && !isString(value.updatedAt)) ||
    !isString(value.avatarSeed) ||
    (value.avatarHue !== null && !isAvatarHue(value.avatarHue))
  ) {
    throw new Error("The server returned an invalid agent.");
  }
  return {
    id: value.id,
    name: value.name,
    title: value.title,
    description: value.description,
    preview: value.preview,
    updatedAt: value.updatedAt,
    provider: isAgentProvider(value.provider) ? value.provider : undefined,
    model: isAgentModel(value.model) ? value.model : undefined,
    reasoningEffort: isReasoningEffort(value.reasoningEffort) ? value.reasoningEffort : undefined,
    avatarSeed: value.avatarSeed,
    avatarHue: value.avatarHue,
  };
}

function decodeAgentSummaries(value: unknown): RemoteAgent[] {
  if (!Array.isArray(value)) throw new Error("The server returned an invalid agent list.");
  return value.map(decodeAgent);
}

function decodeConversationReads(value: unknown): Record<string, { unreadCount: number }> {
  if (!isDynamicRecord(value)) throw new Error("The server returned invalid read states.");
  const reads: Record<string, { unreadCount: number }> = {};
  for (const [agentId, readState] of Object.entries(value)) {
    if (
      !isDynamicRecord(readState) ||
      !isNumber(readState.unreadCount) ||
      !Number.isSafeInteger(readState.unreadCount) ||
      readState.unreadCount < 0
    ) {
      throw new Error("The server returned an invalid read state.");
    }
    reads[agentId] = { unreadCount: readState.unreadCount };
  }
  return reads;
}

function ignoreResponse(): void {}

function updateAgentPayload(input: UpdateAgentInput): TeamProtocolV2Json {
  return {
    agentId: input.agentId,
    ...(input.name === undefined ? {} : { name: input.name }),
    ...(input.title === undefined ? {} : { title: input.title }),
    ...(input.description === undefined ? {} : { description: input.description }),
    ...(input.notifications === undefined ? {} : { notifications: input.notifications }),
    ...(input.provider === undefined ? {} : { provider: input.provider }),
    ...(input.model === undefined ? {} : { model: input.model }),
    ...(input.reasoningEffort === undefined ? {} : { reasoningEffort: input.reasoningEffort }),
    ...(input.avatarSeed === undefined ? {} : { avatarSeed: input.avatarSeed }),
    ...(input.avatarHue === undefined ? {} : { avatarHue: input.avatarHue }),
  };
}
