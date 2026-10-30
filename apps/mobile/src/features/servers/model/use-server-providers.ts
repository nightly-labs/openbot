import type { AgentStatus, ProviderRuntimeSnapshot } from "@openbot/contracts/ipc";
import { skipToken, useQuery, useQueryClient } from "@tanstack/react-query";
import { useCallback, useMemo, useRef } from "react";
import { useQueryScope } from "@/features/auth/context/mobile-session-context";
import { providerRows } from "@/features/servers/model/provider-admin";
import { useMobileWorkspace, useMobileWorkspaceActions } from "@/features/workspace/context/mobile-workspace-context";
import { queryKeys } from "@/features/workspace/model/query-keys";

/** The host sends no runtime event, so the runtimes are read again while a download runs, as on the web. */
const RUNTIME_POLL_MS = 1000;
/** The phone does not read the host's status events, so the status is read again while a sign-in waits. */
const STATUS_POLL_MS = 3000;

/**
 * The providers of a host (`providers-v1`), as the Providers page and each provider page show them.
 * Both pages read the same queries, so a change on one shows on the other.
 */
export function useServerProviders(serverId: string, options: { watchStatus?: boolean } = {}) {
  const { canManageProviders } = useMobileWorkspace();
  const { providerAdmin } = useMobileWorkspaceActions();
  const queryScope = useQueryScope();
  const queryClient = useQueryClient();
  const available = canManageProviders(serverId);
  const admin = useMemo(() => (available ? providerAdmin(serverId) : null), [available, providerAdmin, serverId]);
  const statusKey = queryKeys.providerStatus(queryScope, serverId);
  const runtimesKey = queryKeys.providerRuntimes(queryScope, serverId);
  // The scope is a new array on each render, so the callbacks read the keys of the latest render.
  const keys = useRef({ statusKey, runtimesKey });
  keys.current = { statusKey, runtimesKey };
  /** Shows the status that an action answered, and stops an older read from replacing it. */
  const applyStatus = useCallback(
    async (next: AgentStatus) => {
      const queryKey = keys.current.statusKey;
      await queryClient.cancelQueries({ queryKey, exact: true });
      queryClient.setQueryData(queryKey, next);
    },
    [queryClient],
  );
  const applyRuntimes = useCallback(
    async (next: ProviderRuntimeSnapshot) => {
      const queryKey = keys.current.runtimesKey;
      await queryClient.cancelQueries({ queryKey, exact: true });
      queryClient.setQueryData(queryKey, next);
    },
    [queryClient],
  );
  const refreshStatus = useCallback(
    () => queryClient.invalidateQueries({ queryKey: keys.current.statusKey, exact: true }),
    [queryClient],
  );
  const status = useQuery({
    queryKey: statusKey,
    retry: false,
    staleTime: 0,
    refetchInterval: options.watchStatus ? STATUS_POLL_MS : false,
    queryFn: admin ? () => admin.readStatus() : skipToken,
  });
  const runtimes = useQuery({
    queryKey: runtimesKey,
    retry: false,
    staleTime: 0,
    refetchInterval: (query) =>
      Object.values(query.state.data?.providers ?? {}).some(
        (runtime) => runtime.phase === "downloading" || runtime.phase === "finishing",
      )
        ? RUNTIME_POLL_MS
        : false,
    queryFn: admin ? () => admin.readRuntimes() : skipToken,
  });
  const rows = useMemo(
    () => (admin ? providerRows(status.data, runtimes.data, admin.capabilities) : []),
    [admin, status.data, runtimes.data],
  );
  return {
    available,
    admin,
    status,
    runtimes,
    rows,
    applyStatus,
    applyRuntimes,
    refreshStatus,
  };
}
