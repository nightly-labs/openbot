import { useQuery } from "@tanstack/react-query";
import { useQueryScope } from "@/features/auth/context/mobile-session-context";
import { useMobileWorkspace, useMobileWorkspaceActions } from "@/features/workspace/context/mobile-workspace-context";
import { queryKeys } from "@/features/workspace/model/query-keys";

export function useServerSites(serverId: string) {
  const { canViewHostedSites, canDeleteHostedSites } = useMobileWorkspace();
  const { loadHostedSites, deleteHostedSite } = useMobileWorkspaceActions();
  const queryScope = useQueryScope();
  const available = canViewHostedSites(serverId);
  const query = useQuery({
    queryKey: queryKeys.serverSites(queryScope, serverId),
    enabled: available,
    retry: false,
    staleTime: 0,
    queryFn: () => loadHostedSites(serverId),
  });
  return {
    available,
    canDelete: canDeleteHostedSites(serverId),
    query,
    async remove(siteId: string): Promise<void> {
      await deleteHostedSite(siteId, serverId);
      void query.refetch();
    },
  };
}
