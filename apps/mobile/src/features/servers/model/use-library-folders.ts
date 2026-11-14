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

/**
 * The changes of one server that wait for the host, kept outside React so the Library and its sheets
 * share them. The host gets one change at a time, in the order of the user's actions. A failed change
 * drops the changes made on top of it: `generation` goes up and the queued ones do not go.
 */
interface ChangeLane {
  queue: Promise<void>;
  pending: number;
  generation: number;
  /** The cause of the failed change that dropped the changes after it. A dropped change rejects with it. */
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

/** The id of a new folder. The client makes it, as on desktop. */
export function newLibraryFolderId(): string {
  return randomUUID();
}

/**
 * Applies one folder change: it shows at once, then goes to the host, and the answer of the host
 * replaces the folders. A refused change brings back what the host has now and rejects with the cause.
 */
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
  // A read that started before this change must not replace it. The base is read after the cancel,
  // so a second change made at once applies on top of the first.
  await queryClient.cancelQueries({ queryKey, exact: true });
  const base = queryClient.getQueryData<LibraryFoldersSnapshot>(queryKey);
  if (!base) return;
  let next: LibraryFoldersSnapshot | null = null;
  try {
    next = applyLibraryFolderAction(base, action, context);
  } catch (error) {
    // This phone can know less than the host, for example before the files load. The host decides.
    if (!(error instanceof LibraryFolderRefusal)) throw error;
  }
  if (next === base) return;
  if (next) queryClient.setQueryData(queryKey, next);
  lane.pending += 1;
  const generation = lane.generation;
  const run = lane.queue.then(async () => {
    // An earlier change failed, and this one was made on top of it: it does not go, and it fails too.
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
        // Another member can be the cause, so the host tells what it has now.
        void queryClient.invalidateQueries({ queryKey, exact: true });
      }
      throw cause;
    }
  });
  lane.queue = run.catch(() => undefined);
  await run;
}

/**
 * The Library folders of one server (`library-folders-v1`). With `library-folders-events-v1` the host
 * sends `library-folders-changed` after each change from any device or agent, and that event reads
 * the folders again while the Library shows them. `files` are the files of the host scan: a folder
 * change needs the agent of each file, as on the host.
 */
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
    // The page reads the folders each time it shows: an event can be lost while the phone is offline
    // or the app is in the background.
    staleTime: 0,
    queryFn: async () => {
      const answer = await loadLibraryFolders(serverId);
      // A change waits for the host: the screen keeps it, and the answer of the change comes after.
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
    /** The folders, or null on a host without them and before the first answer. */
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

/**
 * The Library of one server: the files of the host scan, the folders, and the agents whose folders
 * this person changes. A member changes the folders of an agent that they can chat with; an owner or
 * an admin changes all. The host checks it again.
 */
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
