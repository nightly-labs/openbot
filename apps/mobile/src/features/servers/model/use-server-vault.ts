import type { VaultState } from "@openbot/contracts/ipc";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useQueryScope } from "@/features/auth/context/mobile-session-context";
import { useLockedMutation } from "@/features/servers/model/use-locked-action";
import {
  useMobileWorkspaceActions,
  useMobileWorkspaceSelector,
} from "@/features/workspace/context/mobile-workspace-context";
import { queryKeys } from "@/features/workspace/model/query-keys";

export function useServerVault(serverId: string) {
  const server = useMobileWorkspaceSelector((workspace) => workspace.servers.find((item) => item.id === serverId));
  const canManage = useMobileWorkspaceSelector((workspace) => workspace.canManageVault(serverId));
  const canImport = useMobileWorkspaceSelector((workspace) => workspace.canImportVault(serverId));
  const canManageApiKeys = useMobileWorkspaceSelector((workspace) => workspace.canManageVaultApiKeys(serverId));
  const canManageTwoStep = useMobileWorkspaceSelector((workspace) => workspace.canManageVaultTwoStep(serverId));
  const { loadVault } = useMobileWorkspaceActions();
  const queryScope = useQueryScope();
  const queryClient = useQueryClient();
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
    canImport,
    canManageApiKeys,
    canManageTwoStep,
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
