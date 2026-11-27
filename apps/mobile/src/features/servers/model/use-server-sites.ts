import { useQuery } from "@tanstack/react-query";
import { useQueryScope } from "@/features/auth/context/mobile-session-context";
import {
  useMobileWorkspaceActions,
  useMobileWorkspaceSelector,
} from "@/features/workspace/context/mobile-workspace-context";
import { queryKeys } from "@/features/workspace/model/query-keys";

export function useServerSites(serverId: string) {
  const available = useMobileWorkspaceSelector((workspace) => workspace.canViewHostedSites(serverId));
  const canDelete = useMobileWorkspaceSelector((workspace) => workspace.canDeleteHostedSites(serverId));
  const { loadHostedSites, deleteHostedSite } = useMobileWorkspaceActions();
  const queryScope = useQueryScope();
  const query = useQuery({
    queryKey: queryKeys.serverSites(queryScope, serverId),
    enabled: available,
    retry: false,
    staleTime: 0,
    queryFn: () => loadHostedSites(serverId),
  });
  return {
    available,
    canDelete,
    query,
    async remove(siteId: string): Promise<void> {
      await deleteHostedSite(siteId, serverId);
      void query.refetch();
    },
  };
}
