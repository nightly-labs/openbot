import {
  DEFAULT_MCP_SERVER_ACCESS,
  type McpAccessLevel,
  type McpServerAccess,
  type McpServerConfig,
  type McpSignInState,
  type SetMcpAccessInput,
} from "@openbot/contracts/ipc";
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

/** The MCP server list of one host, for a user who manages it. The Server settings row needs only this. */
export function useMcpServerList(serverId: string) {
  // A selector, not the whole workspace: the chat composer reads this list, and must not render again
  // for every workspace change.
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

/**
 * The MCP servers of one host, as the MCP and MCP server pages of the server sheet show them. The
 * pages use the same queries, so a change on one page shows on the other.
 */
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
  // A badge only: a failed read shows no badge.
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
    /** The host answers each change with the whole list. A read still in flight has the old list. */
    async setList(configs: McpServerConfig[]): Promise<void> {
      await queryClient.cancelQueries({ queryKey: listKey, exact: true });
      queryClient.setQueryData(listKey, configs);
    },
    setSignIns(states: McpSignInState[]): void {
      queryClient.setQueryData(signInsKey, states);
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

/**
 * Who gets the MCP servers of one host (`mcp-access-v1`). An owner or admin reads each entry and the
 * roles of the host, and replaces the entry of one MCP server with the revision that it read. A
 * member reads only `mine`, the level of the member for each MCP server. `enabled` false: no request.
 */
export function useMcpAccess(serverId: string, enabled = true) {
  const admin = useMobileWorkspaceSelector((workspace) => workspace.canManageMcpAccess(serverId));
  const limited = useMobileWorkspaceSelector((workspace) => workspace.hasMcpAccessLimits(serverId));
  const roleList = useMobileWorkspaceSelector((workspace) => workspace.canManageServerRoles(serverId));
  const { loadMcpAccess, setMcpAccess, loadServerRoles } = useMobileWorkspaceActions();
  const queryScope = useQueryScope();
  const queryClient = useQueryClient();
  const key = queryKeys.mcpAccess(queryScope, serverId);
  const locked = useRef(false);
  const access = useQuery({
    queryKey: key,
    enabled: enabled && (admin || limited),
    retry: false,
    staleTime: 0,
    queryFn: () => loadMcpAccess(serverId),
  });
  // The same query as the Roles pages. A host without roles gives Everyone only.
  const roles = useQuery({
    queryKey: queryKeys.serverRoles(queryScope, serverId),
    enabled: enabled && admin && roleList,
    retry: false,
    staleTime: 0,
    // As on the Roles pages: a role page must not start from an old revision.
    gcTime: 0,
    queryFn: () => loadServerRoles(serverId),
  });
  const action = useMutation({
    mutationFn: (input: SetMcpAccessInput) => setMcpAccess(input, serverId),
    onSuccess: async (saved) => {
      void haptics.notification("success");
      await queryClient.cancelQueries({ queryKey: key, exact: true });
      queryClient.setQueryData(key, saved);
    },
    onError: () => {
      void haptics.notification("error");
      // Another admin saved first, or the host refused the change: show what it holds now.
      void access.refetch();
    },
    onSettled: () => {
      locked.current = false;
    },
  });
  const snapshot = access.data;
  return {
    /** True when this user sets who gets each MCP server, also while the entries load or fail. */
    manages: admin,
    /** True when this user sets who gets each MCP server, and the entries are on hand. */
    admin: admin && Boolean(snapshot?.servers),
    access,
    action,
    roles: roles.data?.roles ?? [],
    /** The stored entry of one MCP server, or the default of a server with no entry. */
    entry(mcpServerId: string): McpServerAccess {
      return snapshot?.servers?.[mcpServerId] ?? DEFAULT_MCP_SERVER_ACCESS;
    },
    /** The level of a member for one MCP server: `manage` for an owner or admin, null while unknown. */
    mine(mcpServerId: string): McpAccessLevel | null {
      if (!limited) return "manage";
      return snapshot?.mine[mcpServerId] ?? null;
    },
    /** Replaces the entry of one MCP server, one change at a time. Resolves true when it succeeds. */
    set(mcpServerId: string, next: McpServerAccess): Promise<boolean> {
      if (locked.current || !snapshot) return Promise.resolve(false);
      locked.current = true;
      return action.mutateAsync({ revision: snapshot.revision, mcpServerId, access: next }).then(
        () => true,
        () => false,
      );
    },
  };
}
