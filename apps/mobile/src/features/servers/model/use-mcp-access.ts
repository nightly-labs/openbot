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

/** True when the access gives the MCP server to `agentId`. */
export function mcpAccessAllows(access: McpServerAccess, agentId: string): boolean {
  return access.agents === null || access.agents.includes(agentId);
}

/** The new access after the level of Everyone changes. A role keeps only a level above it. */
export function withEveryoneLevel(access: McpServerAccess, level: McpAccessLevel): McpServerAccess {
  return {
    ...access,
    everyone: level,
    roles: Object.fromEntries(
      Object.entries(access.roles).filter(([, own]) => mcpAccessRank(own) > mcpAccessRank(level)),
    ),
  };
}

/** The new access after the level of one role changes. The level of Everyone needs no entry. */
export function withRoleLevel(access: McpServerAccess, roleId: string, level: McpAccessLevel): McpServerAccess {
  const roles = Object.fromEntries(Object.entries(access.roles).filter(([id]) => id !== roleId));
  return { ...access, roles: level === access.everyone ? roles : { ...roles, [roleId]: level } };
}

/** The level that a role gets: its own level, or the level of Everyone when that is higher. */
export function mcpRoleLevel(access: McpServerAccess, roleId: string): McpAccessLevel {
  const own = access.roles[roleId] ?? "none";
  return mcpAccessRank(own) > mcpAccessRank(access.everyone) ? own : access.everyone;
}

/**
 * Who gets one MCP server of a host (`mcp-access-v1`), for an owner or admin: the agents and the level
 * of Everyone and of each role. Each change sends the whole entry with the revision that it read; the
 * host refuses a stale one, and the page reads the access again.
 */
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
      // Another admin saved first, or the host refused the change: show what it holds now.
      void snapshot.refetch();
    },
    onSettled: () => {
      locked.current = false;
    },
  });
  const data = snapshot.data;
  // A server with no stored entry gives each agent and lets each member use it.
  const entry = data ? copyMcpServerAccess(data.servers?.[mcpServerId] ?? DEFAULT_MCP_SERVER_ACCESS) : undefined;
  return {
    available,
    snapshot,
    action,
    entry,
    /** Runs one change at a time on a copy of the entry. Resolves true when it succeeds. */
    save(edit: (access: McpServerAccess) => McpServerAccess): Promise<boolean> {
      // The cache, not this render: a change right after a save must name the newest revision.
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
