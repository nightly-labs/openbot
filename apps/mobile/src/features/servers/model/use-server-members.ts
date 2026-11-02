import { DEFAULT_TEAM_MEMBER_LIMIT } from "@openbot/contracts/input-limits";
import { canAdministerServer } from "@openbot/contracts/ipc";
import type { RemoteTeamInvite } from "@openbot/team-client";
import { runTeamEffect } from "@openbot/team-client";
import { useMutation, useQuery } from "@tanstack/react-query";
import { useRef } from "react";
import { useQueryScope } from "@/features/auth/context/mobile-session-context";
import { useMobileWorkspace } from "@/features/workspace/context/mobile-workspace-context";
import { queryKeys } from "@/features/workspace/model/query-keys";
import { haptics } from "@/shared/lib/haptics";

/** An invitation that someone can still accept. A permanent link stays open after each join. */
function isPendingInvite(invite: RemoteTeamInvite, now: number): boolean {
  return (invite.permanent || !invite.usedAt) && !invite.revokedAt && invite.expiresAt > now;
}

/**
 * The members and invitations of one server, as the Members, Invite and Member pages of the server
 * sheet show them. The pages use the same queries, so a change on one page shows on the others.
 */
export function useServerMembers(serverId: string) {
  const { servers, teamDirectory } = useMobileWorkspace();
  const queryScope = useQueryScope();
  const server = servers.find((candidate) => candidate.id === serverId);
  const canManage = canAdministerServer(server?.role);
  const locked = useRef(false);
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
  const action = useMutation({
    mutationFn: (operation: () => Promise<void>) => operation(),
    onSuccess: () => {
      void haptics.notification("success");
      // A refresh failure must not retry a committed membership change or invitation.
      void members.refetch();
      if (canManage) void invites.refetch();
    },
    onError: () => {
      void haptics.notification("error");
    },
    onSettled: () => {
      locked.current = false;
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
    /** Runs one change at a time. Resolves true when it succeeds. */
    perform(operation: () => Promise<void>): Promise<boolean> {
      if (locked.current) return Promise.resolve(false);
      locked.current = true;
      return action.mutateAsync(operation).then(
        () => true,
        () => false,
      );
    },
    refresh() {
      void members.refetch();
      if (canManage) void invites.refetch();
    },
  };
}
