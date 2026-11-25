import type { McpServerConfig, McpSignInState } from "@openbot/contracts/ipc";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useQueryScope } from "@/features/auth/context/mobile-session-context";
import { useLockedMutation } from "@/features/servers/model/use-locked-action";
import {
  useMobileWorkspace,
  useMobileWorkspaceActions,
  useMobileWorkspaceSelector,
} from "@/features/workspace/context/mobile-workspace-context";
import { queryKeys } from "@/features/workspace/model/query-keys";

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

export function useMcpSignIns(serverId: string, canManage: boolean) {
  const { listMcpSignIns } = useMobileWorkspaceActions();
  const queryScope = useQueryScope();
  return useQuery({
    queryKey: queryKeys.mcpSignIns(queryScope, serverId),
    enabled: canManage,
    retry: false,
    queryFn: () => listMcpSignIns(serverId),
  });
}

export function useServerMcp(serverId: string) {
  const { servers } = useMobileWorkspace();
  const queryScope = useQueryScope();
  const queryClient = useQueryClient();
  const server = servers.find((candidate) => candidate.id === serverId);
  const { canManage, list } = useMcpServerList(serverId);
  const listKey = queryKeys.mcpServers(queryScope, serverId);
  const signInsKey = queryKeys.mcpSignIns(queryScope, serverId);
  const signIns = useMcpSignIns(serverId, canManage);
  const { action, perform } = useLockedMutation();
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
    perform,
  };
}
