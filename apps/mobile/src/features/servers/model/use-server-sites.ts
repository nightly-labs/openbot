import { useQuery } from "@tanstack/react-query";
import { useQueryScope } from "@/features/auth/context/mobile-session-context";
import { useMobileWorkspace, useMobileWorkspaceActions } from "@/features/workspace/context/mobile-workspace-context";
import { queryKeys } from "@/features/workspace/model/query-keys";

/**
 * The openbot.site sites of one server (`hosted-sites-v1`), as Server settings and its Sites page
 * show them. Both pages read one query, so a deleted site goes from both.
 */
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
    /** An owner or admin. A member sees the sites, without Delete. */
    canDelete: canDeleteHostedSites(serverId),
    query,
    async remove(siteId: string): Promise<void> {
      await deleteHostedSite(siteId, serverId);
      // A failed read must not show the deletion as failed: the host already deleted the site.
      void query.refetch();
    },
  };
}
