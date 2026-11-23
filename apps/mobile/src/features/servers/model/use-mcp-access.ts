import {
  copyMcpServerAccess,
  DEFAULT_MCP_SERVER_ACCESS,
  type McpAccessLevel,
  type McpAccessSnapshot,
  type McpServerAccess,
  mcpAccessRank,
} from "@openbot/contracts/ipc";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useRef } from "react";
import { useQueryScope } from "@/features/auth/context/mobile-session-context";
import {
  useMobileWorkspaceActions,
  useMobileWorkspaceSelector,
} from "@/features/workspace/context/mobile-workspace-context";
import { queryKeys } from "@/features/workspace/model/query-keys";
import { haptics } from "@/shared/lib/haptics";

export function mcpAccessAllows(access: McpServerAccess, agentId: string): boolean {
  return access.agents === null || access.agents.includes(agentId);
}

export function withEveryoneLevel(access: McpServerAccess, level: McpAccessLevel): McpServerAccess {
  return {
    ...access,
    everyone: level,
    roles: Object.fromEntries(
      Object.entries(access.roles).filter(([, own]) => mcpAccessRank(own) > mcpAccessRank(level)),
    ),
  };
}

export function withRoleLevel(access: McpServerAccess, roleId: string, level: McpAccessLevel): McpServerAccess {
  const roles = Object.fromEntries(Object.entries(access.roles).filter(([id]) => id !== roleId));
  return { ...access, roles: level === access.everyone ? roles : { ...roles, [roleId]: level } };
}

export function mcpRoleLevel(access: McpServerAccess, roleId: string): McpAccessLevel {
  const own = access.roles[roleId] ?? "none";
  return mcpAccessRank(own) > mcpAccessRank(access.everyone) ? own : access.everyone;
}

export function useMcpAccess(serverId: string, mcpServerId: string) {
  const available = useMobileWorkspaceSelector((workspace) => workspace.canManageMcpAccess(serverId));
  const { loadMcpAccess, setMcpAccess } = useMobileWorkspaceActions();
  const queryScope = useQueryScope();
  const queryClient = useQueryClient();
  const key = queryKeys.mcpAccess(queryScope, serverId);
  const locked = useRef(false);
  const snapshot = useQuery({
    queryKey: key,
    enabled: available,
    retry: false,
    staleTime: 0,
    queryFn: () => loadMcpAccess(serverId),
  });
  const action = useMutation({
    mutationFn: (input: { revision: number; access: McpServerAccess }) =>
      setMcpAccess({ revision: input.revision, mcpServerId, access: input.access }, serverId),
    onSuccess: async (saved) => {
      void haptics.notification("success");
      await queryClient.cancelQueries({ queryKey: key, exact: true });
      queryClient.setQueryData(key, saved);
    },
    onError: () => {
      void haptics.notification("error");
      void snapshot.refetch();
    },
    onSettled: () => {
      locked.current = false;
    },
  });
  const data = snapshot.data;
  const entry = data ? copyMcpServerAccess(data.servers?.[mcpServerId] ?? DEFAULT_MCP_SERVER_ACCESS) : undefined;
  return {
    available,
    snapshot,
    action,
    entry,
    save(edit: (access: McpServerAccess) => McpServerAccess): Promise<boolean> {
      const held = queryClient.getQueryData<McpAccessSnapshot>(key);
      if (locked.current || !held) return Promise.resolve(false);
      locked.current = true;
      const current = copyMcpServerAccess(held.servers?.[mcpServerId] ?? DEFAULT_MCP_SERVER_ACCESS);
      return action.mutateAsync({ revision: held.revision, access: edit(current) }).then(
        () => true,
        () => false,
      );
    },
  };
}
