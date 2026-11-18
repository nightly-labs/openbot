import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useQueryScope } from "@/features/auth/context/mobile-session-context";
import { useMobileWorkspace, useMobileWorkspaceActions } from "@/features/workspace/context/mobile-workspace-context";
import { queryKeys } from "@/features/workspace/model/query-keys";

/**
 * The host's storage (`storage-v1`), as the Storage page and its Files page show it. Both pages read
 * one query, so a deletion on the Files page shows on the Storage page.
 */
export function useServerStorage(serverId: string) {
  const { canReadServerStorage } = useMobileWorkspace();
  const { loadServerStorage, readKeptLibrary, keepLibrary } = useMobileWorkspaceActions();
  const queryScope = useQueryScope();
  const queryClient = useQueryClient();
  const queryKey = queryKeys.serverStorage(queryScope, serverId);
  const available = canReadServerStorage(serverId);
  const query = useQuery({
    queryKey,
    enabled: available,
    retry: false,
    staleTime: 0,
    queryFn: async () => {
      const usage = await loadServerStorage(serverId);
      keepLibrary(serverId, usage);
      return usage;
    },
  });
  // The list of the last open, from this phone. It shows while the host measures, or when it cannot answer.
  const kept = useQuery({
    queryKey: queryKeys.serverKeptLibrary(queryScope, serverId),
    enabled: available,
    retry: false,
    staleTime: Infinity,
    queryFn: () => readKeptLibrary(serverId),
  });
  return {
    available,
    query,
    /** The host's answer, or the list that this phone kept from the last answer. */
    usage: query.data ?? kept.data ?? undefined,
    /** The host caches a scan. A retry, a deletion or a clear measures again, as on desktop. */
    async rescan(): Promise<void> {
      await queryClient.fetchQuery({
        queryKey,
        staleTime: 0,
        queryFn: async () => {
          const usage = await loadServerStorage(serverId, true);
          keepLibrary(serverId, usage);
          return usage;
        },
      });
      await queryClient.invalidateQueries({ queryKey: queryKeys.serverDisk(queryScope, serverId) });
    },
  };
}

/**
 * The disk of a hosted server, read when the Storage page opens and after each measurement, as on
 * desktop. The page shows what the plan has left, not the free space of the whole disk.
 */
export function useServerDisk(serverId: string, enabled: boolean) {
  const { loadServerDisk } = useMobileWorkspaceActions();
  const queryScope = useQueryScope();
  return useQuery({
    queryKey: queryKeys.serverDisk(queryScope, serverId),
    enabled,
    retry: false,
    staleTime: 0,
    queryFn: () => loadServerDisk(serverId),
  });
}
