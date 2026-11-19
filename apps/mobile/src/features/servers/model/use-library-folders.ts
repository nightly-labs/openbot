import {
  agentAccessRank,
  applyLibraryFolderAction,
  type LibraryFolderAction,
  type LibraryFolderContext,
  LibraryFolderRefusal,
  type LibraryFoldersSnapshot,
  type StoredFileRow,
} from "@openbot/contracts/ipc";
import { type QueryClient, useQuery, useQueryClient } from "@tanstack/react-query";
import { randomUUID } from "expo-crypto";
import { useMemo } from "react";
import { useQueryScope } from "@/features/auth/context/mobile-session-context";
import { useAgentAccessLevels } from "@/features/servers/model/use-server-roles";
import { useServerStorage } from "@/features/servers/model/use-server-storage";
import {
  useMobileWorkspaceActions,
  useMobileWorkspaceSelector,
} from "@/features/workspace/context/mobile-workspace-context";
import { type QueryScope, queryKeys } from "@/features/workspace/model/query-keys";
import type { MobileWorkspaceContextValue } from "@/features/workspace/model/workspace-types";

interface ChangeLane {
  queue: Promise<void>;
  pending: number;
  generation: number;
  failure: unknown;
}
const lanes = new Map<string, ChangeLane>();

function laneOf(key: string): ChangeLane {
  let lane = lanes.get(key);
  if (!lane) {
    lane = { queue: Promise.resolve(), pending: 0, generation: 0, failure: undefined };
    lanes.set(key, lane);
  }
  return lane;
}

export function newLibraryFolderId(): string {
  return randomUUID();
}

async function changeFolders(
  queryClient: QueryClient,
  scope: QueryScope,
  serverId: string,
  action: LibraryFolderAction,
  context: LibraryFolderContext,
  send: MobileWorkspaceContextValue["changeLibraryFolders"],
): Promise<void> {
  const queryKey = queryKeys.serverLibraryFolders(scope, serverId);
  const lane = laneOf(JSON.stringify(queryKey));
  await queryClient.cancelQueries({ queryKey, exact: true });
  const base = queryClient.getQueryData<LibraryFoldersSnapshot>(queryKey);
  if (!base) return;
  let next: LibraryFoldersSnapshot | null = null;
  try {
    next = applyLibraryFolderAction(base, action, context);
  } catch (error) {
    if (!(error instanceof LibraryFolderRefusal)) throw error;
  }
  if (next === base) return;
  if (next) queryClient.setQueryData(queryKey, next);
  lane.pending += 1;
  const generation = lane.generation;
  const run = lane.queue.then(async () => {
    if (generation !== lane.generation) throw lane.failure;
    try {
      const answer = await send(action, serverId);
      if (generation !== lane.generation) return;
      lane.pending -= 1;
      if (lane.pending === 0) queryClient.setQueryData(queryKey, answer);
    } catch (cause) {
      if (generation === lane.generation) {
        lane.generation += 1;
        lane.pending = 0;
        lane.failure = cause;
        void queryClient.invalidateQueries({ queryKey, exact: true });
      }
      throw cause;
    }
  });
  lane.queue = run.catch(() => undefined);
  await run;
}

function useLibraryFolders(serverId: string, files: readonly StoredFileRow[] | undefined) {
  const available = useMobileWorkspaceSelector((workspace) => workspace.canOrganizeLibrary(serverId));
  const agents = useMobileWorkspaceSelector((workspace) => workspace.agents);
  const { loadLibraryFolders, changeLibraryFolders } = useMobileWorkspaceActions();
  const scope = useQueryScope();
  const queryClient = useQueryClient();
  const queryKey = queryKeys.serverLibraryFolders(scope, serverId);
  const query = useQuery({
    queryKey,
    enabled: available,
    retry: false,
    staleTime: 0,
    queryFn: async () => {
      const answer = await loadLibraryFolders(serverId);
      return laneOf(JSON.stringify(queryKey)).pending > 0
        ? (queryClient.getQueryData<LibraryFoldersSnapshot>(queryKey) ?? answer)
        : answer;
    },
  });
  const livingAgentIds = useMemo(
    () => new Set(agents.filter((agent) => agent.serverId === serverId).map((agent) => agent.id)),
    [agents, serverId],
  );
  const fileAgents = useMemo(() => new Map((files ?? []).map((file) => [file.id, file.agentId] as const)), [files]);
  return {
    available,
    query,
    snapshot: available ? (query.data ?? null) : null,
    livingAgentIds,
    change: (action: LibraryFolderAction) =>
      changeFolders(
        queryClient,
        scope,
        serverId,
        action,
        { agentIds: livingAgentIds, fileAgent: (fileId) => fileAgents.get(fileId) },
        changeLibraryFolders,
      ),
  };
}

export function useLibrary(serverId: string) {
  const storage = useServerStorage(serverId);
  const folders = useLibraryFolders(serverId, storage.query.data?.files);
  const levels = useAgentAccessLevels(serverId);
  const canOrganize = (agentId: string | null): agentId is string => {
    if (agentId === null || !folders.livingAgentIds.has(agentId)) return false;
    if (!levels.limited) return true;
    const level = levels.level(agentId);
    return level !== null && agentAccessRank(level) >= agentAccessRank("chat");
  };
  return { storage, folders, canOrganize };
}
