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

export function everyoneLevel(everyone: AgentAccessLevels, agentId: string): AgentAccessLevel {
  return everyone[agentId] ?? "manage";
}

export function roleLevel(role: AgentAccessRole, agentId: string): AgentAccessLevel {
  return role.agents[agentId] ?? "none";
}

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

export function useAgentViewOnly(serverId: string, agentId: string): boolean {
  return useAgentAccessLevel(serverId, agentId) === "view";
}

export function useAgentAccessLevel(serverId: string, agentId: string): AgentAccessLevel | null {
  return useAgentAccessLevels(serverId).level(agentId);
}

export function useAgentAccessLevels(serverId: string): {
  limited: boolean;
  level: (agentId: string) => AgentAccessLevel | null;
} {
  const limited = useMobileWorkspaceSelector((workspace) => workspace.hasAgentAccessLimits(serverId));
  const role = useMobileWorkspaceSelector(
    (workspace) => workspace.servers.find((server) => server.id === serverId)?.role,
  );
  const { loadServerRoles } = useMobileWorkspaceActions();
  const queryScope = useQueryScope();
  const access = useQuery({
    queryKey: queryKeys.serverRoles(queryScope, serverId),
    enabled: limited,
    gcTime: Number.POSITIVE_INFINITY,
    queryFn: () => loadServerRoles(serverId),
  });
  const mine = access.data?.mine;
  return {
    limited,
    level: (agentId) => (canAdministerServer(role) ? "manage" : (mine?.[agentId] ?? null)),
  };
}

export function setRoleMember(change: AgentAccessChange, roleId: string, memberId: string, on: boolean): void {
  const role = change.roles.find((item) => item.id === roleId);
  if (!role) return;
  const others = role.memberIds.filter((id) => id !== memberId);
  role.memberIds = on ? [...others, memberId] : others;
}

export function memberRoleNames(roles: readonly AgentAccessRole[] | undefined, memberId: string): string[] {
  return (roles ?? []).filter((role) => role.memberIds.includes(memberId)).map((role) => role.name);
}
