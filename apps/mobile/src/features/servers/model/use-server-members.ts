import { DEFAULT_TEAM_MEMBER_LIMIT } from "@openbot/contracts/input-limits";
import { canAdministerServer } from "@openbot/contracts/ipc";
import type { RemoteTeamInvite } from "@openbot/team-client";
import { runTeamEffect } from "@openbot/team-client";
import { useQuery } from "@tanstack/react-query";
import { useQueryScope } from "@/features/auth/context/mobile-session-context";
import { useLockedMutation } from "@/features/servers/model/use-locked-action";
import { useMobileWorkspace } from "@/features/workspace/context/mobile-workspace-context";
import { queryKeys } from "@/features/workspace/model/query-keys";

function isPendingInvite(invite: RemoteTeamInvite, now: number): boolean {
  return (invite.permanent || !invite.usedAt) && !invite.revokedAt && invite.expiresAt > now;
}

export function useServerMembers(serverId: string) {
  const { servers, teamDirectory } = useMobileWorkspace();
  const queryScope = useQueryScope();
  const server = servers.find((candidate) => candidate.id === serverId);
  const canManage = canAdministerServer(server?.role);
  const members = useQuery({
    queryKey: queryKeys.serverMembers(queryScope, serverId),
    enabled: Boolean(server),
    retry: false,
    gcTime: 0,
    queryFn: () => runTeamEffect(teamDirectory.listMembers(serverId)),
  });
  const invites = useQuery({
    queryKey: queryKeys.serverInvites(queryScope, serverId),
    enabled: canManage,
    retry: false,
    gcTime: 0,
    queryFn: () => runTeamEffect(teamDirectory.listInvites(serverId)),
  });
  const { action, perform } = useLockedMutation({
    success: () => {
      void members.refetch();
      if (canManage) void invites.refetch();
    },
  });
  const now = Date.now();
  const activeMembers = members.data?.filter((member) => member.status === "active");
  const pendingInvites = invites.data?.filter((invite) => isPendingInvite(invite, now));
  const memberLimit = server?.memberLimit ?? DEFAULT_TEAM_MEMBER_LIMIT;
  return {
    server,
    teamDirectory,
    canManage,
    members,
    invites,
    activeMembers,
    pendingInvites,
    memberLimit,
    membersFull: (activeMembers?.length ?? 0) >= memberLimit,
    action,
    perform,
    refresh() {
      void members.refetch();
      if (canManage) void invites.refetch();
    },
  };
}
