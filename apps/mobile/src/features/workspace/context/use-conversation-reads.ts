import { TEAM_API_ROUTES } from "@openbot/contracts/team-api-routes";
import { CONVERSATION_UNREAD_FROM_ROUTE } from "@openbot/contracts/team-protocol/conversation-unread-from-v1";
import { TEAM_CONVERSATION_UNREAD_CAPABILITY } from "@openbot/contracts/team-protocol/current";
import { type createRemoteReadRefresh, mergeRemoteUnreadIds, runTeamEffect } from "@openbot/team-client";
import { Effect } from "effect";
import { type RefObject, useCallback, useRef } from "react";
import { showFailureAlert, showWarningAlert } from "@/features/analytics/failure-reports";
import { latestReadBoundaryMessage } from "@/features/chat/model/chat-messages";
import type { WorkspaceRequest } from "@/features/workspace/context/host-request-actions";
import { decodeConversationPage } from "@/features/workspace/model/conversation";
import type { MobileConversationStore } from "@/features/workspace/model/conversation-store";
import type { LiveWorkspaceStore } from "@/features/workspace/model/live-workspace-store";
import { hasCapability, type ServerCapabilities } from "@/features/workspace/model/server-capabilities";
import { decodeConversationReads, type MobileConversationRead } from "@/features/workspace/model/workspace-records";
import type { MobileAgent, MobileWorkspaceContextValue } from "@/features/workspace/model/workspace-types";
import { currentText } from "@/shared/lib/text";

const EVENT_READS_INTERVAL_MS = 1_000;

type ReadMark = { kind: "read"; throughMessageId?: string } | { kind: "unread"; fromMessageId?: string };

export function useConversationReads({
  liveState,
  readRefresh,
  request,
  loadConversation,
  conversationStore,
  loadGeneration,
  removedServers,
  capabilities,
  activeServerId,
  agents,
  readSynced,
}: {
  liveState: LiveWorkspaceStore;
  readRefresh: ReturnType<typeof createRemoteReadRefresh>;
  request: WorkspaceRequest;
  loadConversation: MobileWorkspaceContextValue["loadConversation"];
  conversationStore: MobileConversationStore;
  loadGeneration: RefObject<number>;
  removedServers: RefObject<Set<string>>;
  capabilities: ServerCapabilities;
  activeServerId: RefObject<string | null>;
  agents: RefObject<MobileAgent[]>;
  readSynced: (
    serverId: string,
    fallback: () => Promise<Record<string, MobileConversationRead>>,
  ) => Promise<Record<string, MobileConversationRead>>;
}) {
  const readWrites = useRef(new Map<string, Promise<void>>());
  const applyConversationReads = useCallback(
    (reads: Record<string, MobileConversationRead>) => {
      liveState.update("unreadAgentIds", (current) => mergeRemoteUnreadIds(current, reads));
      liveState.update("unreadCounts", (current) =>
        Object.entries(reads).every(([agentId, read]) => current[agentId] === read.unreadCount)
          ? current
          : {
              ...current,
              ...Object.fromEntries(Object.entries(reads).map(([agentId, read]) => [agentId, read.unreadCount])),
            },
      );
      liveState.update("firstUnreadMessageIds", (current) =>
        Object.entries(reads).every(([agentId, read]) => current[agentId] === read.firstUnreadMessageId)
          ? current
          : {
              ...current,
              ...Object.fromEntries(
                Object.entries(reads).map(([agentId, read]) => [agentId, read.firstUnreadMessageId]),
              ),
            },
      );
    },
    [liveState],
  );

  const readLoads = useRef(new Map<string, { promise: Promise<void>; again: boolean }>());
  const readStarts = useRef(new Map<string, number>());
  const waitingReads = useRef(new Map<string, Promise<void>>());
  const readConversationReadsNow = useCallback(
    (serverId = activeServerId.current): Promise<void> => {
      if (!serverId) return Promise.resolve();
      const pending = readLoads.current.get(serverId);
      if (pending) {
        pending.again = true;
        return pending.promise;
      }
      const read = () =>
        runTeamEffect(
          readRefresh.refresh(
            serverId,
            () =>
              Effect.tryPromise(() =>
                readSynced(serverId, () =>
                  request(
                    "GET",
                    TEAM_API_ROUTES.agents.conversationReads,
                    decodeConversationReads,
                    undefined,
                    serverId,
                  ),
                ),
              ),
            applyConversationReads,
            () => !removedServers.current.has(serverId),
          ),
        );
      const load = { again: false, promise: Promise.resolve() };
      load.promise = (async () => {
        try {
          do {
            load.again = false;
            readStarts.current.set(serverId, Date.now());
            try {
              await read();
            } catch (error) {
              if (!load.again) throw error;
            }
          } while (load.again && !removedServers.current.has(serverId));
        } finally {
          readLoads.current.delete(serverId);
        }
      })();
      readLoads.current.set(serverId, load);
      return load.promise;
    },
    [request, readRefresh, applyConversationReads, activeServerId, removedServers, readSynced],
  );

  const refreshConversationReads = useCallback(
    (serverId = activeServerId.current): Promise<void> => {
      if (!serverId) return Promise.resolve();
      const waiting = waitingReads.current.get(serverId);
      if (waiting) return waiting;
      const wait = (readStarts.current.get(serverId) ?? 0) + EVENT_READS_INTERVAL_MS - Date.now();
      if (wait <= 0) return readConversationReadsNow(serverId);
      const read = new Promise<void>((resolve) => setTimeout(resolve, wait)).then(() => {
        waitingReads.current.delete(serverId);
        return removedServers.current.has(serverId) ? undefined : readConversationReadsNow(serverId);
      });
      waitingReads.current.set(serverId, read);
      return read;
    },
    [activeServerId, removedServers, readConversationReadsNow],
  );

  const writeAgentRead = useCallback(
    (agentId: string, mark: ReadMark, serverId = activeServerId.current): Promise<void> => {
      if (!serverId) return Promise.resolve();
      const isCurrentRead = readRefresh.invalidate(serverId);
      const generation = loadGeneration.current;
      liveState.update("unreadAgentIds", (current) =>
        mark.kind === "unread" ? [...new Set([...current, agentId])] : current.filter((id) => id !== agentId),
      );
      const write = (readWrites.current.get(agentId) ?? Promise.resolve())
        .then(async () => {
          if (generation !== loadGeneration.current) return;
          const decode = (value: unknown) => decodeConversationReads({ [agentId]: value });
          let reads: Record<string, MobileConversationRead>;
          if (mark.kind === "unread") {
            reads =
              mark.fromMessageId === undefined
                ? await request("POST", TEAM_API_ROUTES.agent.conversationUnread(agentId), decode, {}, serverId)
                : await request(
                    "POST",
                    CONVERSATION_UNREAD_FROM_ROUTE,
                    decode,
                    { agentId, fromMessageId: mark.fromMessageId },
                    serverId,
                  );
          } else {
            const cached = conversationStore.get(agentId);
            const snapshot =
              mark.throughMessageId !== undefined
                ? null
                : cached && conversationStore.isUpToDate(agentId)
                  ? cached
                  : await loadConversation(agentId, serverId);
            if (generation !== loadGeneration.current) return;
            const throughMessageId =
              mark.throughMessageId ??
              (snapshot && (latestReadBoundaryMessage(snapshot.messages) ?? snapshot.messages.at(-1)))?.id;
            if (throughMessageId === undefined) return;
            reads = await request(
              "POST",
              TEAM_API_ROUTES.agent.conversationRead(agentId),
              decode,
              { throughMessageId },
              serverId,
            );
          }
          if (generation === loadGeneration.current && isCurrentRead()) {
            readRefresh.invalidate(serverId);
            applyConversationReads(reads);
          }
        })
        .catch((error: unknown) => {
          if (generation === loadGeneration.current) void readConversationReadsNow(serverId).catch(() => undefined);
          throw error;
        });
      const settled = write.catch(() => undefined);
      readWrites.current.set(agentId, settled);
      void settled.finally(() => {
        if (readWrites.current.get(agentId) === settled) readWrites.current.delete(agentId);
      });
      return write;
    },
    [
      liveState,
      request,
      readConversationReadsNow,
      loadConversation,
      activeServerId,
      loadGeneration,
      readRefresh,
      conversationStore,
      applyConversationReads,
    ],
  );

  const markAgentRead = useCallback(
    (agentId: string, visibleMessageId?: string | null, targetServerId?: string) => {
      const serverId = targetServerId ?? activeServerId.current;
      if (visibleMessageId === null && !hasCapability(capabilities, serverId, TEAM_CONVERSATION_UNREAD_CAPABILITY)) {
        showWarningAlert(
          "team",
          currentText().t("mobile.workspace.alert.updateRequiredTitle"),
          currentText().t("mobile.workspace.alert.updateRequiredUnread"),
        );
        return;
      }
      const mark: ReadMark =
        visibleMessageId === null
          ? { kind: "unread" }
          : visibleMessageId === undefined
            ? { kind: "read" }
            : { kind: "read", throughMessageId: visibleMessageId };
      void writeAgentRead(agentId, mark, serverId ?? undefined).catch((error: unknown) => {
        if (visibleMessageId === null)
          showFailureAlert(
            error,
            "settings",
            currentText().t("mobile.workspace.alert.markUnreadTitle"),
            currentText().t("mobile.workspace.alert.markUnreadBody"),
          );
      });
    },
    [activeServerId, capabilities, writeAgentRead],
  );

  const markAllRead = useCallback(async () => {
    const serverId = activeServerId.current;
    if (!serverId) return;
    const listed = new Set(agents.current.filter((agent) => agent.serverId === serverId).map((agent) => agent.id));
    const unread = liveState.get().unreadAgentIds.filter((agentId) => listed.has(agentId));
    const results = await Promise.allSettled(
      unread.map(async (agentId) => {
        const page = await request(
          "GET",
          `${TEAM_API_ROUTES.agent.conversationPage(agentId)}?limit=1`,
          decodeConversationPage,
          undefined,
          serverId,
        );
        const latestId = page.messages.at(-1)?.id;
        if (latestId) await writeAgentRead(agentId, { kind: "read", throughMessageId: latestId }, serverId);
      }),
    );
    const failure = results.find((result) => result.status === "rejected");
    if (!failure) return;
    await readConversationReadsNow(serverId).catch(() => undefined);
    throw failure.reason;
  }, [activeServerId, agents, liveState, request, writeAgentRead, readConversationReadsNow]);

  const markAgentUnreadFrom = useCallback(
    (agentId: string, fromMessageId: string, serverId: string) =>
      writeAgentRead(agentId, { kind: "unread", fromMessageId }, serverId),
    [writeAgentRead],
  );

  return { applyConversationReads, refreshConversationReads, markAgentRead, markAgentUnreadFrom, markAllRead };
}
