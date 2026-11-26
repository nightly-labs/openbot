import type { HostTimezoneSettings } from "@openbot/contracts/ipc";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useQueryScope } from "@/features/auth/context/mobile-session-context";
import { useMobileWorkspace, useMobileWorkspaceActions } from "@/features/workspace/context/mobile-workspace-context";
import { queryKeys } from "@/features/workspace/model/query-keys";

export function useServerTimezone(serverId: string) {
  const { canManageServerTimezone } = useMobileWorkspace();
  const { loadServerTimezone, setServerTimezone } = useMobileWorkspaceActions();
  const queryScope = useQueryScope();
  const queryClient = useQueryClient();
  const queryKey = queryKeys.serverTimezone(queryScope, serverId);
  const available = canManageServerTimezone(serverId);
  const query = useQuery({
    queryKey,
    enabled: available,
    retry: false,
    staleTime: 0,
    queryFn: () => loadServerTimezone(serverId),
  });
  return {
    available,
    query,
    async save(timezone: string | null): Promise<HostTimezoneSettings> {
      const saved = await setServerTimezone(timezone, serverId);
      await queryClient.cancelQueries({ queryKey, exact: true });
      queryClient.setQueryData(queryKey, saved);
      return saved;
    },
  };
}
