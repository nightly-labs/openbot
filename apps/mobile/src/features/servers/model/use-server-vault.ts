import type { VaultState } from "@openbot/contracts/ipc";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useRef } from "react";
import { useQueryScope } from "@/features/auth/context/mobile-session-context";
import { useMobileWorkspace, useMobileWorkspaceActions } from "@/features/workspace/context/mobile-workspace-context";
import { queryKeys } from "@/features/workspace/model/query-keys";
import { haptics } from "@/shared/lib/haptics";

/**
 * The Vault of one joined server (`vault-v1`, or `vault-v2` with API keys), for an owner or admin.
 * The Vault page and the item page read one query, so a change on one shows on the other. The host
 * answers each change with the whole state, which carries no secret.
 */
export function useServerVault(serverId: string) {
  const { servers, canManageVault, canImportVault, canManageVaultApiKeys } = useMobileWorkspace();
  const { loadVault } = useMobileWorkspaceActions();
  const queryScope = useQueryScope();
  const queryClient = useQueryClient();
  const server = servers.find((candidate) => candidate.id === serverId);
  const canManage = canManageVault(serverId);
  const key = queryKeys.serverVault(queryScope, serverId);
  // An agent or another device can change the Vault, and the phone gets no event: each page reads it again.
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
    query,
    action,
    /** Shows the state that the host answered. A read still in flight has the old state. */
    async setState(state: VaultState): Promise<void> {
      await queryClient.cancelQueries({ queryKey: key, exact: true });
      queryClient.setQueryData(key, state);
    },
    /** Runs one change at a time. Resolves true when it succeeds. */
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
