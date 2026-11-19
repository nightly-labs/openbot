import type { VaultState } from "@openbot/contracts/ipc";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useQueryScope } from "@/features/auth/context/mobile-session-context";
import { useLockedMutation } from "@/features/servers/model/use-locked-action";
import { useMobileWorkspace, useMobileWorkspaceActions } from "@/features/workspace/context/mobile-workspace-context";
import { queryKeys } from "@/features/workspace/model/query-keys";

export function useServerVault(serverId: string) {
  const { servers, canManageVault, canImportVault, canManageVaultApiKeys, canManageVaultTwoStep } =
    useMobileWorkspace();
  const { loadVault } = useMobileWorkspaceActions();
  const queryScope = useQueryScope();
  const queryClient = useQueryClient();
  const server = servers.find((candidate) => candidate.id === serverId);
  const canManage = canManageVault(serverId);
  const key = queryKeys.serverVault(queryScope, serverId);
  const query = useQuery({
    queryKey: key,
    enabled: canManage,
    retry: false,
    staleTime: 0,
    queryFn: () => loadVault(serverId),
  });
  const { action, perform } = useLockedMutation();
  return {
    server,
    canManage,
    canImport: canImportVault(serverId),
    canManageApiKeys: canManageVaultApiKeys(serverId),
    canManageTwoStep: canManageVaultTwoStep(serverId),
    query,
    action,
    async setState(state: VaultState): Promise<void> {
      await queryClient.cancelQueries({ queryKey: key, exact: true });
      queryClient.setQueryData(key, state);
      void queryClient.invalidateQueries({ queryKey: queryKeys.serverVaultCodes(queryScope, serverId), exact: true });
    },
    perform,
  };
}
