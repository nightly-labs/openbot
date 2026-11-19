import type { McpServerConfig, McpSignInState } from "@openbot/contracts/ipc";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useRef } from "react";
import { useQueryScope } from "@/features/auth/context/mobile-session-context";
import {
  useMobileWorkspace,
  useMobileWorkspaceActions,
  useMobileWorkspaceSelector,
} from "@/features/workspace/context/mobile-workspace-context";
import { queryKeys } from "@/features/workspace/model/query-keys";
import { haptics } from "@/shared/lib/haptics";

export function useMcpServerList(serverId: string) {
  const canManage = useMobileWorkspaceSelector((workspace) => workspace.canManageMcpServers(serverId));
  const { listMcpServers } = useMobileWorkspaceActions();
  const queryScope = useQueryScope();
  const list = useQuery({
    queryKey: queryKeys.mcpServers(queryScope, serverId),
    enabled: canManage,
    retry: false,
    queryFn: () => listMcpServers(serverId),
  });
  return { canManage, list };
}

export function useServerMcp(serverId: string) {
  const { servers } = useMobileWorkspace();
  const { listMcpSignIns } = useMobileWorkspaceActions();
  const queryScope = useQueryScope();
  const queryClient = useQueryClient();
  const server = servers.find((candidate) => candidate.id === serverId);
  const { canManage, list } = useMcpServerList(serverId);
  const locked = useRef(false);
  const listKey = queryKeys.mcpServers(queryScope, serverId);
  const signInsKey = queryKeys.mcpSignIns(queryScope, serverId);
  const signIns = useQuery({
    queryKey: signInsKey,
    enabled: canManage,
    retry: false,
    queryFn: () => listMcpSignIns(serverId).catch((): McpSignInState[] => []),
  });
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
    list,
    signIns,
    action,
    async setList(configs: McpServerConfig[]): Promise<void> {
      await queryClient.cancelQueries({ queryKey: listKey, exact: true });
      queryClient.setQueryData(listKey, configs);
    },
    setSignIns(states: McpSignInState[]): void {
      queryClient.setQueryData(signInsKey, states);
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
