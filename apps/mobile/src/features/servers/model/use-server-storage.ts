import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useQueryScope } from "@/features/auth/context/mobile-session-context";
import { useMobileWorkspace, useMobileWorkspaceActions } from "@/features/workspace/context/mobile-workspace-context";
import { queryKeys } from "@/features/workspace/model/query-keys";

export function useServerStorage(serverId: string) {
  const { canReadServerStorage, knownServerChecks } = useMobileWorkspace();
  const { loadServerStorage, readKeptLibrary, keepLibrary } = useMobileWorkspaceActions();
  const queryScope = useQueryScope();
  const queryClient = useQueryClient();
  const queryKey = queryKeys.serverStorage(queryScope, serverId);
  const connected = canReadServerStorage(serverId);
  const available = connected || (knownServerChecks(serverId)?.canReadServerStorage(serverId) ?? false);
  const query = useQuery({
    queryKey,
    enabled: connected,
    retry: false,
    staleTime: 0,
    queryFn: async () => {
      const usage = await loadServerStorage(serverId);
      keepLibrary(serverId, usage);
      return usage;
    },
  });
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
    usage: query.data ?? kept.data ?? undefined,
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
