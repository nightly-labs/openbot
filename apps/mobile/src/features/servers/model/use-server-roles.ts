import {
  type AgentAccessChange,
  type AgentAccessLevel,
  type AgentAccessLevels,
  type AgentAccessRole,
  canAdministerServer,
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

/** Everyone gives `manage` for an agent that it does not list; another role gives `none`. */
export function everyoneLevel(everyone: AgentAccessLevels, agentId: string): AgentAccessLevel {
  return everyone[agentId] ?? "manage";
}

export function roleLevel(role: AgentAccessRole, agentId: string): AgentAccessLevel {
  return role.agents[agentId] ?? "none";
}

/**
 * The roles of one server (`agent-access-v1`), as the Roles, Role and Member pages of the server
 * sheet show them. Each change saves the whole set with the revision that it read; the host refuses
 * a stale one, and the pages read the roles again.
 */
export function useServerRoles(serverId: string) {
  const available = useMobileWorkspaceSelector((workspace) => workspace.canManageServerRoles(serverId));
  const agents = useMobileWorkspaceSelector((workspace) => workspace.agents);
  const { loadServerRoles, setServerRoles } = useMobileWorkspaceActions();
  const queryScope = useQueryScope();
  const queryClient = useQueryClient();
  const key = queryKeys.serverRoles(queryScope, serverId);
  const locked = useRef(false);
  const roles = useQuery({
    queryKey: key,
    enabled: available,
    retry: false,
    staleTime: 0,
    gcTime: 0,
    queryFn: () => loadServerRoles(serverId),
  });
  const action = useMutation({
    mutationFn: (change: AgentAccessChange) => setServerRoles(change, serverId),
    onSuccess: async (saved) => {
      void haptics.notification("success");
      await queryClient.cancelQueries({ queryKey: key, exact: true });
      queryClient.setQueryData(key, saved);
    },
    onError: () => {
      void haptics.notification("error");
      // Another admin saved first, or the host refused the change: show what it holds now.
      void roles.refetch();
    },
    onSettled: () => {
      locked.current = false;
    },
  });
  const snapshot = roles.data;
  return {
    available,
    roles,
    action,
    everyone: snapshot?.everyone,
    list: snapshot?.roles,
    agents: agents.filter((agent) => agent.serverId === serverId),
    /** Runs one change at a time on a copy of the roles. Resolves true when it succeeds. */
    save(edit: (change: AgentAccessChange) => void): Promise<boolean> {
      if (locked.current || !snapshot?.everyone || !snapshot.roles) return Promise.resolve(false);
      locked.current = true;
      const change: AgentAccessChange = {
        revision: snapshot.revision,
        everyone: { ...snapshot.everyone },
        roles: snapshot.roles.map((role) => ({ ...role, agents: { ...role.agents }, memberIds: [...role.memberIds] })),
      };
      edit(change);
      return action.mutateAsync(change).then(
        () => true,
        () => false,
      );
    },
  };
}

/**
 * True when the roles let this person only view `agentId`. The host sends each change of the roles as
 * `agents-changed` too, and that event reads the levels again. Unknown levels do not limit: the host
 * checks each write.
 */
export function useAgentViewOnly(serverId: string, agentId: string): boolean {
  const limited = useMobileWorkspaceSelector((workspace) => workspace.hasAgentAccessLimits(serverId));
  // An owner or admin can use all agents, also with levels read before a promotion.
  const role = useMobileWorkspaceSelector(
    (workspace) => workspace.servers.find((server) => server.id === serverId)?.role,
  );
  const { loadServerRoles } = useMobileWorkspaceActions();
  const queryScope = useQueryScope();
  const access = useQuery({
    queryKey: queryKeys.serverRoles(queryScope, serverId),
    enabled: limited,
    // Kept while the app runs: offline, the last levels that the host sent still apply. After a
    // restart offline, the levels are unknown until the host answers.
    gcTime: Number.POSITIVE_INFINITY,
    queryFn: () => loadServerRoles(serverId),
  });
  return !canAdministerServer(role) && access.data?.mine[agentId] === "view";
}

/** Adds `memberId` to the role or takes it out. */
export function setRoleMember(change: AgentAccessChange, roleId: string, memberId: string, on: boolean): void {
  const role = change.roles.find((item) => item.id === roleId);
  if (!role) return;
  const others = role.memberIds.filter((id) => id !== memberId);
  role.memberIds = on ? [...others, memberId] : others;
}

/** The names of the roles that `memberId` has, in the order of the server. */
export function memberRoleNames(roles: readonly AgentAccessRole[] | undefined, memberId: string): string[] {
  return (roles ?? []).filter((role) => role.memberIds.includes(memberId)).map((role) => role.name);
}
