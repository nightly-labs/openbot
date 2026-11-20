import type { AgentTaskReadState, AgentTasksSnapshot } from "@openbot/contracts/ipc";
import { useQueryClient } from "@tanstack/react-query";
import {
  createContext,
  type PropsWithChildren,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useSyncExternalStore,
} from "react";
import { useMobileSession } from "@/features/auth/context/mobile-session-context";
import { useAgentThreadUnreadCounts } from "@/features/chat/components/use-agent-thread-reads";
import { selectLiveState } from "@/features/workspace/components/use-live-workspace";
import { useMobileWorkspaceSelector } from "@/features/workspace/context/mobile-workspace-context";
import type { MobileAgentActivity } from "@/features/workspace/model/agent-activity";
import { type QueryScope, queryKeys } from "@/features/workspace/model/query-keys";
import { agentThreadWaitReason } from "@/features/workspace/model/thread-waits";

export interface HomeListAgentLiveSlice {
  activity: MobileAgentActivity | undefined;
  unreadCount: number;
  threadUnread: boolean;
}

const EMPTY_SLICE: HomeListAgentLiveSlice = {
  activity: undefined,
  unreadCount: 0,
  threadUnread: false,
};

function mergeAgentListActivity(
  own: MobileAgentActivity | undefined,
  threadWait: ReturnType<typeof agentThreadWaitReason>,
  threadRunning: boolean,
): MobileAgentActivity | undefined {
  if (own?.phase === "waiting") return own;
  if (threadWait) return { turnId: null, phase: "waiting", detail: null, reason: threadWait };
  if (own) return own;
  return threadRunning ? { turnId: null, phase: "working", detail: null } : undefined;
}

function activityEqual(left: MobileAgentActivity | undefined, right: MobileAgentActivity | undefined): boolean {
  if (left === right) return true;
  if (!left || !right) return false;
  return (
    left.turnId === right.turnId &&
    left.phase === right.phase &&
    left.reason === right.reason &&
    left.detail === right.detail
  );
}

function sliceEqual(left: HomeListAgentLiveSlice, right: HomeListAgentLiveSlice): boolean {
  return (
    left.unreadCount === right.unreadCount &&
    left.threadUnread === right.threadUnread &&
    activityEqual(left.activity, right.activity)
  );
}

class HomeListLiveStore {
  readonly #slices = new Map<string, HomeListAgentLiveSlice>();
  readonly #listeners = new Map<string, Set<() => void>>();

  subscribe(agentId: string, listener: () => void): () => void {
    let set = this.#listeners.get(agentId);
    if (!set) {
      set = new Set();
      this.#listeners.set(agentId, set);
    }
    set.add(listener);
    return () => {
      set?.delete(listener);
      if (set?.size === 0) this.#listeners.delete(agentId);
    };
  }

  getSlice(agentId: string): HomeListAgentLiveSlice {
    return this.#slices.get(agentId) ?? EMPTY_SLICE;
  }

  seed(agentIds: readonly string[], nextOf: (agentId: string) => HomeListAgentLiveSlice): void {
    for (const agentId of agentIds) {
      this.#slices.set(agentId, nextOf(agentId));
    }
  }

  refresh(agentIds: readonly string[], nextOf: (agentId: string) => HomeListAgentLiveSlice): void {
    for (const agentId of agentIds) {
      const next = nextOf(agentId);
      const prev = this.#slices.get(agentId);
      if (prev && sliceEqual(prev, next)) continue;
      this.#slices.set(agentId, next);
      for (const listener of this.#listeners.get(agentId) ?? []) listener();
    }
  }
}

const HomeListLiveSnapshotContext = createContext<HomeListLiveStore | null>(null);

interface HomeListLiveSnapshotProviderProps extends PropsWithChildren {
  serverId: string;
  online: boolean;
  agentIds: readonly string[];
  threadReadsEnabled: boolean;
}

export function HomeListLiveSnapshotProvider({
  children,
  serverId,
  online,
  agentIds,
  threadReadsEnabled,
}: HomeListLiveSnapshotProviderProps) {
  const liveState = useMobileWorkspaceSelector(selectLiveState);
  const queryClient = useQueryClient();
  const { session, sessionScope } = useMobileSession();
  const apiUrl = session?.apiUrl;
  const userId = session?.user.id;
  const queryScope = useMemo<QueryScope>(() => [apiUrl, userId, sessionScope], [apiUrl, userId, sessionScope]);
  const store = useRef(new HomeListLiveStore()).current;

  const compute = useCallback(
    (agentId: string): HomeListAgentLiveSlice => {
      const snapshot = liveState.get();
      const own = online ? snapshot.activityByServer[serverId]?.[agentId] : undefined;
      const threadWait = online
        ? agentThreadWaitReason(snapshot.threadWaitsByServer[serverId] ?? [], agentId)
        : undefined;
      const tasks = queryClient.getQueryData<AgentTasksSnapshot>(queryKeys.agentTasks(queryScope, serverId, agentId));
      const threadRunning = online === true && tasks?.tasks.some((task) => task.state === "running") === true;
      const activity = mergeAgentListActivity(own, threadWait, threadRunning);
      const unreadListed = snapshot.unreadAgentIds.includes(agentId);
      const unreadCount = unreadListed ? Math.max(1, snapshot.unreadCounts[agentId] ?? 0) : 0;
      const reads = queryClient.getQueryData<AgentTaskReadState[]>(
        queryKeys.agentThreadReads(queryScope, serverId, agentId),
      );
      const threadUnread = threadReadsEnabled && (reads ?? []).reduce((sum, read) => sum + read.unreadCount, 0) > 0;
      return { activity, unreadCount, threadUnread };
    },
    [liveState, online, queryClient, queryScope, serverId, threadReadsEnabled],
  );

  useMemo(() => {
    store.seed(agentIds, compute);
  }, [agentIds, compute, store]);

  useEffect(() => {
    const refresh = () => store.refresh(agentIds, compute);
    const stopLive = liveState.subscribe(refresh);
    const scopeLength = queryScope.length;
    const serverKeyIndex = 1 + scopeLength;
    const stopQuery = queryClient.getQueryCache().subscribe((event) => {
      if (event.type !== "updated" && event.type !== "added" && event.type !== "removed") return;
      const key = event.query.queryKey;
      if (!Array.isArray(key) || key[0] !== "server-tasks") return;
      if (key[serverKeyIndex] !== serverId) return;
      const kind = key[serverKeyIndex + 1];
      if (kind === "agent" || kind === "reads") refresh();
    });
    return () => {
      stopLive();
      stopQuery();
    };
  }, [agentIds, compute, liveState, queryClient, queryScope, serverId, store]);

  return <HomeListLiveSnapshotContext value={store}>{children}</HomeListLiveSnapshotContext>;
}

export function useHomeListAgentSlice(agentId: string): HomeListAgentLiveSlice {
  const store = useContext(HomeListLiveSnapshotContext);
  const slice = useSyncExternalStore(
    (listener) => (store ? store.subscribe(agentId, listener) : () => {}),
    () => (store ? store.getSlice(agentId) : EMPTY_SLICE),
    () => (store ? store.getSlice(agentId) : EMPTY_SLICE),
  );
  if (!store) throw new Error("useHomeListAgentSlice requires HomeListLiveSnapshotProvider.");
  return slice;
}

export function HomeThreadReadsPrefetch({ serverId, agentIds }: { serverId: string; agentIds: readonly string[] }) {
  useAgentThreadUnreadCounts(serverId, agentIds);
  return null;
}
