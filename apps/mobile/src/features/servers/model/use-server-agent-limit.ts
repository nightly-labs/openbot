import type { HostAgentLimitSettings } from "@openbot/contracts/ipc";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useQueryScope } from "@/features/auth/context/mobile-session-context";
import { useMobileWorkspace, useMobileWorkspaceActions } from "@/features/workspace/context/mobile-workspace-context";
import { queryKeys } from "@/features/workspace/model/query-keys";

export function useServerAgentLimit(serverId: string) {
  const { canManageServerAgentLimit } = useMobileWorkspace();
  const { loadServerAgentLimit, setServerAgentLimit } = useMobileWorkspaceActions();
  const queryScope = useQueryScope();
  const queryClient = useQueryClient();
  const queryKey = queryKeys.serverAgentLimit(queryScope, serverId);
  const available = canManageServerAgentLimit(serverId);
  const query = useQuery({
    queryKey,
    enabled: available,
    retry: false,
    staleTime: 0,
    queryFn: () => loadServerAgentLimit(serverId),
  });
  return {
    available,
    query,
    async save(limit: number | null): Promise<HostAgentLimitSettings> {
      const saved = await setServerAgentLimit(limit, serverId);
      await queryClient.cancelQueries({ queryKey, exact: true });
      queryClient.setQueryData(queryKey, saved);
      return saved;
    },
  };
}
