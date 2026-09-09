import {
  type AgentEvent,
  type AgentSummary,
  type ConversationSnapshot,
  type CreateAgentInput,
  isAttachmentSummary,
  isAvatarHue,
  isQueuedMessageReceipt,
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
  createRemoteDirectoryRefresh,
  createRemoteReadRefresh,
  createWorkspacePreferences,
  mergeRemoteUnreadIds,
  type RemoteRecoveryStatus,
  RemoteTeamDirectoryClient,
  type RemoteTeamHost,
  type RemoteWorkspacePreferences,
  readAgentAnalytics,
  resyncRemoteConversations,
  watchRemoteDirectory,
} from "@openbot/team-client";
import type { RemoteFileUpload } from "@openbot/team-client/remote-peer";
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
import { Alert, AppState, View } from "react-native";

import { useMobileSession } from "@/features/auth/context/mobile-session-context";
import type { RemoteTeamTransportRef } from "@/features/workspace/components/remote-team-transport";
import {
  ServerConnection,
  type ServerConnectionHandle,
  type ServerLoadContext,
} from "@/features/workspace/components/server-connection";
import { type MobileAgentActivities, reduceAgentActivity } from "@/features/workspace/model/agent-activity";
import { conversationMessageId, decodeConversation } from "@/features/workspace/model/conversation";
import { applyServerRecovery, serverKind } from "@/features/workspace/model/server-status";
import { trustedHostKeys } from "@/features/workspace/model/trusted-host-keys";
import type {
  MobileAgent,
  MobileServer,
  MobileServerDirectoryState,
  MobileWorkspaceContextValue,
} from "@/features/workspace/model/workspace-types";

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
>;
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
  const [foreground, setForeground] = useState(AppState.currentState !== "background");
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
  const [conversations, setConversations] = useState<Record<string, ConversationSnapshot>>({});
  const [activityByServer, setActivityByServer] = useState<Record<string, MobileAgentActivities>>({});
  const conversationsRef = useRef(conversations);
  conversationsRef.current = conversations;
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
        setConversations((current) =>
          Object.fromEntries(Object.entries(current).filter(([id]) => !removedAgentIds.has(id))),
        );
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
    [session.host?.hostId, session.apiUrl, session.user.id, sessionScope, queryClient, readRefresh],
  );

  const directoryRefresh = useMemo(
    () =>
      createRemoteDirectoryRefresh(async () => {
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
          setServerDirectoryError(error instanceof Error ? error.message : "The server directory is unavailable.");
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
    void refreshHosts().catch(() => undefined);
    return () => {
      directoryGeneration.current += 1;
      directoryRefresh.invalidate();
    };
  }, [refreshHosts, directoryRefresh]);

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
      setActivityByServer((current) => ({ ...current, [serverId]: {} }));
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
      await resyncRemoteConversations({
        agentIds: summaries.map((agent) => agent.id),
        cached: conversationsRef.current,
        load: (agentId) => client.request("GET", TEAM_API_ROUTES.agent.conversation(agentId), decodeConversation),
        apply: (snapshot) => setConversations((current) => storeNewestSnapshot(current, snapshot)),
        isCurrent: context.isCurrent,
      });
      context.stage = "connection";
    },
    [replaceServerAgents, preferenceStore, readRefresh],
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
    let connectionActive = AppState.currentState !== "background";
    const subscription = AppState.addEventListener("change", (state) => {
      // iOS system overlays report inactive without putting the app in the background.
      if (state === "inactive") return;
      const active = state === "active";
      if (active === connectionActive) return;
      connectionActive = active;
      setForeground(active);
      if (!active) {
        loadGeneration.current += 1;
      }
    });
    return () => subscription.remove();
  }, []);

  useEffect(() => {
    if (!foreground) return;
    return watchRemoteDirectory(() => directoryRefresh.refresh());
  }, [foreground, directoryRefresh]);

  const loadConversation = useCallback(
    async (agentId: string, serverId = activeServerIdRef.current) => {
      const generation = loadGeneration.current;
      const snapshot = await request(
        "GET",
        TEAM_API_ROUTES.agent.conversation(agentId),
        decodeConversation,
        undefined,
        serverId,
      );
      if (generation === loadGeneration.current) setConversations((current) => storeNewestSnapshot(current, snapshot));
      return snapshot;
    },
    [request],
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
        event.snapshot.revision >= (conversationsRef.current[event.snapshot.agentId]?.revision ?? 0)
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
      if (event.type === "agents-changed") replaceServerAgents(serverId, event.agents);
      else if (event.type === "conversation") {
        const knownIds = serverAgentIds.current.get(serverId) ?? new Set<string>();
        knownIds.add(event.snapshot.agentId);
        serverAgentIds.current.set(serverId, knownIds);
        setConversations((current) => storeNewestSnapshot(current, event.snapshot));
      } else if (event.type === "conversation-delta") {
        setConversations((current) => {
          const snapshot = current[event.agentId];
          if (!snapshot || event.revision <= snapshot.revision) return current;
          const messageIndex = snapshot.messages.findIndex((message) => message.id === event.messageId);
          const messages = [...snapshot.messages];
          if (messageIndex === -1) {
            messages.push({
              id: event.messageId,
              turnId: event.turnId,
              author: "assistant",
              source: "assistant",
              text: event.delta,
              createdAt: event.createdAt,
              status: "streaming",
            });
          } else {
            const message = messages[messageIndex];
            if (!message) return current;
            messages[messageIndex] = { ...message, text: message.text + event.delta, status: "streaming" };
          }
          return {
            ...current,
            [event.agentId]: {
              ...snapshot,
              threadId: event.threadId,
              activeTurnId: event.turnId,
              revision: event.revision,
              messages,
            },
          };
        });
      } else if (event.type === "conversation-page") {
        const readState = event.page.readState;
        if (readState) {
          readRefresh.invalidate(serverId);
          setUnreadAgentIds((current) => mergeRemoteUnreadIds(current, { [event.page.agentId]: readState }));
        } else void refreshConversationReads(serverId).catch(() => undefined);
        if (conversationsRef.current[event.page.agentId])
          void loadConversation(event.page.agentId, serverId).catch(() => undefined);
      } else if (event.type === "conversation-invalidated" || event.type === "turn-completed") {
        if (conversationsRef.current[event.agentId])
          void loadConversation(event.agentId, serverId).catch(() => undefined);
      } else if (event.type === "team-identity") {
        setServers((current) =>
          current.map((server) => (server.id === serverId ? { ...server, name: event.serverName } : server)),
        );
      }
    },
    [
      loadConversation,
      replaceServerAgents,
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
              : (conversationsRef.current[agentId] ?? (await loadConversation(agentId)));
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
    [request, refreshConversationReads, loadConversation, activeServerId, readRefresh],
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
    return {
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
      conversations,
      activityByServer,
      selectServer: (id) => {
        loadGeneration.current += 1;
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
        setConversations((current) =>
          Object.fromEntries(Object.entries(current).filter(([id]) => !removedIds.has(id))),
        );
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
      loadAgentAnalytics: async (input, serverId) => {
        if (
          serverId !== activeServerId ||
          !agents.some((agent) => agent.id === input.agentId && agent.serverId === serverId)
        )
          throw new Error("Agent is not on the selected host.");
        return readAgentAnalytics(request, serverCapabilities.current.get(serverId) ?? [], input);
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
      updateAgent: async (input: UpdateAgentInput) => {
        const updated = await request(
          "PATCH",
          TEAM_API_ROUTES.agent.one(input.agentId),
          decodeAgent,
          updateAgentPayload(input),
        );
        setAgents((current) =>
          current.map((agent) => (agent.id === updated.id ? projectAgent(agent.serverId, updated) : agent)),
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
      discardAttachment: async (agentId, attachmentId) => {
        const serverId = agents.find((candidate) => candidate.id === agentId)?.serverId;
        if (!serverId) throw new Error("The agent is unavailable.");
        await request("DELETE", TEAM_API_ROUTES.attachment(attachmentId), ignoreResponse, undefined, serverId);
      },
      sendMessage: async (agentId, text, attachmentDraftIds = []) => {
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
            replyToMessageId: null,
          },
          serverId,
        );
        return conversationMessageId(receipt, agentId);
      },
      respondToPrompt: async (agentId, input) => {
        const agent = agents.find((candidate) => candidate.id === agentId);
        const snapshot = conversationsRef.current[agentId];
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
        updatePreferences(activeServer.id, (current) => ({
          hidden: [...new Set([...current.hidden, agentId])],
          pinned: current.pinned.filter((id) => id !== agentId),
        }));
      },
      unhideAgent: (agentId) => {
        updatePreferences(activeServer.id, (current) => ({
          ...current,
          hidden: current.hidden.filter((id) => id !== agentId),
        }));
      },
      markAgentRead,
      markAgentUnread: (agentId) => {
        markAgentRead(agentId, null);
      },
      toggleAgentPin: (agentId) => {
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
  }, [
    activeServerId,
    activityByServer,
    agents,
    conversations,
    directory,
    directoryRefresh,
    hiddenAgentIds,
    loadConversation,
    markAgentRead,
    pinnedAgentIds,
    refreshHosts,
    readRefresh,
    request,
    serverDirectoryError,
    serverDirectoryState,
    servers,
    session.host,
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

function storeNewestSnapshot(
  conversations: Record<string, ConversationSnapshot>,
  snapshot: ConversationSnapshot,
): Record<string, ConversationSnapshot> {
  const current = conversations[snapshot.agentId];
  return current && current.revision > snapshot.revision
    ? conversations
    : { ...conversations, [snapshot.agentId]: snapshot };
}
