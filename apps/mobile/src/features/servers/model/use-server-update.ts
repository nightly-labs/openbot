import type { HostReleaseStatus, HostUpdateStatus } from "@openbot/contracts/ipc";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useQueryScope } from "@/features/auth/context/mobile-session-context";
import { useMobileWorkspace, useMobileWorkspaceActions } from "@/features/workspace/context/mobile-workspace-context";
import { queryKeys } from "@/features/workspace/model/query-keys";

export interface ServerUpdateSnapshot {
  status: HostUpdateStatus;
  /** Null when the host does not serve `host-release-v1`. */
  release: HostReleaseStatus | null;
}

/** How often the status is read again while the host checks, downloads or waits to restart. */
const POLL_MS = 1000;
const IDLE_POLL_MS = 15_000;

/**
 * The OpenBot update of a server's host (`host-update-v1`, `host-member-update-v1`), as Server
 * settings and its Updates page show it. The host sends no progress event, so the Updates page
 * reads the status again while something runs there. The host checks permissions on every call.
 */
export function useServerUpdate(serverId: string, { poll }: { poll: boolean }) {
  const { serverUpdateAccess, canReadServerRelease } = useMobileWorkspace();
  const { loadServerUpdate, loadServerRelease } = useMobileWorkspaceActions();
  const queryScope = useQueryScope();
  const queryClient = useQueryClient();
  const queryKey = queryKeys.serverUpdate(queryScope, serverId);
  const access = serverUpdateAccess(serverId);
  const readsRelease = canReadServerRelease(serverId);
  const query = useQuery({
    queryKey,
    enabled: access !== null,
    retry: false,
    staleTime: 0,
    queryFn: async (): Promise<ServerUpdateSnapshot> => {
      if (!access) throw new Error("No update access.");
      const [status, release] = await Promise.all([
        loadServerUpdate(serverId, access),
        readsRelease ? loadServerRelease(serverId) : Promise.resolve(null),
      ]);
      return { status, release };
    },
    refetchInterval: (current) => {
      if (!poll) return false;
      const data = current.state.data;
      return data && (updateRunning(data.status) || data.release?.phase === "checking") ? POLL_MS : IDLE_POLL_MS;
    },
  });
  return {
    access,
    query,
    /** Shows a status or release that an action returned, and stops a read that started before it. */
    async show(change: Partial<ServerUpdateSnapshot>): Promise<void> {
      await queryClient.cancelQueries({ queryKey, exact: true });
      queryClient.setQueryData<ServerUpdateSnapshot>(queryKey, (current) =>
        current ? { ...current, ...change } : change.status ? { status: change.status, release: null } : undefined,
      );
    },
  };
}

export function updateRunning(status: HostUpdateStatus): boolean {
  return (
    status.phase === "checking" ||
    status.phase === "downloading" ||
    status.phase === "installing" ||
    status.restart !== null
  );
}

/**
 * Why no update action can run: the host user turned them off, a Host Manager owns updates, or the
 * build has no updater.
 */
export function updateBlocked(status: HostUpdateStatus): boolean {
  return status.remoteUpdates === "disabled" || status.remoteUpdates === "managed" || status.phase === "unsupported";
}

/**
 * The release check of an installation that does not update itself. Its result replaces the update
 * status in the text, as on the desktop.
 */
export function readOnlyRelease(snapshot: ServerUpdateSnapshot): HostReleaseStatus | null {
  return snapshot.release?.method !== "self-update" || updateBlocked(snapshot.status) ? snapshot.release : null;
}

/** True when the host can install `status.availableVersion`. */
export function updateAvailable(status: HostUpdateStatus): boolean {
  return (
    status.remoteUpdates === "allowed" &&
    status.availableVersion !== null &&
    status.availableVersion !== status.currentVersion &&
    status.phase !== "unsupported" &&
    status.phase !== "up-to-date" &&
    status.errorCode !== "install_failed"
  );
}
