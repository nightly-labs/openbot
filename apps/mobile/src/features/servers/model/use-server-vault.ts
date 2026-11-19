import type { VaultState } from "@openbot/contracts/ipc";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useRef } from "react";
import { useQueryScope } from "@/features/auth/context/mobile-session-context";
import { useMobileWorkspace, useMobileWorkspaceActions } from "@/features/workspace/context/mobile-workspace-context";
import { queryKeys } from "@/features/workspace/model/query-keys";
import { haptics } from "@/shared/lib/haptics";

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
  const locked = useRef(false);
  const action = useMutation({
    mutationFn: (operation: () => Promise<void>) => operation(),
    onSuccess: () => {
      void haptics.notification("success");
    },
    onError: () => {
      void haptics.notification("error");
    },
    onSettled: () => {
      locked.current = false;
    },
  });
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
    perform(operation: () => Promise<void>): Promise<boolean> {
      if (locked.current) return Promise.resolve(false);
      locked.current = true;
      return action.mutateAsync(operation).then(
        () => true,
        () => false,
      );
    },
  };
}
