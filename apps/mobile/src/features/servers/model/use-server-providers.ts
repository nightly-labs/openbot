import type {
  AgentProviderId,
  AgentStatus,
  CustomAgentSummary,
  CustomProviderSummary,
  ProviderRuntimeSnapshot,
} from "@openbot/contracts/ipc";
import { skipToken, useQuery, useQueryClient } from "@tanstack/react-query";
import { useCallback, useMemo, useRef, useState } from "react";
import { useQueryScope } from "@/features/auth/context/mobile-session-context";
import { type ProviderAdmin, providerRows } from "@/features/servers/model/provider-admin";
import { useMobileWorkspace, useMobileWorkspaceActions } from "@/features/workspace/context/mobile-workspace-context";
import { queryKeys } from "@/features/workspace/model/query-keys";
import { haptics } from "@/shared/lib/haptics";
import { useText } from "@/shared/lib/text";

/** The host sends no runtime event, so the runtimes are read again while a download runs, as on the web. */
const RUNTIME_POLL_MS = 1000;
/** The phone does not read the host's status events, so the status is read again while a sign-in waits. */
const STATUS_POLL_MS = 3000;

/** The Providers admin of a host, or null when this member cannot manage its providers. */
export function useProviderAdmin(serverId: string) {
  const { canManageProviders } = useMobileWorkspace();
  const { providerAdmin } = useMobileWorkspaceActions();
  const available = canManageProviders(serverId);
  const admin = useMemo(() => (available ? providerAdmin(serverId) : null), [available, providerAdmin, serverId]);
  return { available, admin };
}

/**
 * The providers of a host (`providers-v1`), as the Providers page and each provider page show them.
 * Both pages read the same queries, so a change on one shows on the other.
 */
export function useServerProviders(serverId: string, options: { watchStatus?: boolean } = {}) {
  const { available, admin } = useProviderAdmin(serverId);
  const queryScope = useQueryScope();
  const queryClient = useQueryClient();
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

/**
 * The custom endpoints of a host, as the Providers page and the custom provider page show them. The
 * host answers each save and removal with the whole list, and `applyList` shows it.
 */
export function useServerCustomProviders(serverId: string, admin: ProviderAdmin | null) {
  const queryScope = useQueryScope();
  const queryClient = useQueryClient();
  const queryKey = queryKeys.customProviders(queryScope, serverId);
  const keys = useRef(queryKey);
  keys.current = queryKey;
  const list = useQuery({
    queryKey,
    retry: false,
    staleTime: 0,
    queryFn: admin ? () => admin.listCustom() : skipToken,
  });
  const applyList = useCallback(
    async (providers: CustomProviderSummary[]) => {
      await queryClient.cancelQueries({ queryKey: keys.current, exact: true });
      queryClient.setQueryData(keys.current, providers);
    },
    [queryClient],
  );
  return { list, applyList };
}

/** The accounts of a host's providers, as the provider page and the account page show them. */
export function useServerProviderAccounts(serverId: string, admin: ProviderAdmin | null) {
  const queryScope = useQueryScope();
  const accounts = admin?.accounts;
  const list = useQuery({
    queryKey: queryKeys.providerAccounts(queryScope, serverId),
    retry: false,
    staleTime: 0,
    queryFn: accounts ? () => accounts.list() : skipToken,
  });
  const refresh = useRefreshProviderAccounts(serverId);
  return { list, refresh };
}

/**
 * Reads the accounts of a host's providers again, for a page that changes them but does not show
 * them. An agent page reads the same accounts under its own key, so a change reads them all again.
 */
export function useRefreshProviderAccounts(serverId: string) {
  const queryClient = useQueryClient();
  return useCallback(
    () =>
      queryClient.invalidateQueries({
        predicate: (query) => query.queryKey.includes("provider-accounts") && query.queryKey.includes(serverId),
      }),
    [queryClient, serverId],
  );
}

/**
 * The provider that a new agent of the host starts on (`provider-default-v1`), as the Providers page
 * and each provider page show it. `choose` saves a provider; the host has no "none".
 */
export function useHostProviderDefault(serverId: string, setting: ProviderAdmin["defaultProvider"]) {
  const { t, errorMessage } = useText();
  const queryScope = useQueryScope();
  const queryClient = useQueryClient();
  const queryKey = queryKeys.providerDefault(queryScope, serverId);
  const current = useQuery({
    queryKey,
    retry: false,
    staleTime: 0,
    queryFn: setting ? () => setting.read() : skipToken,
  });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const choose = (provider: AgentProviderId) => {
    if (!setting || saving || provider === current.data?.provider) return;
    setSaving(true);
    setError(null);
    setting
      .set(provider)
      .then(async (saved) => {
        await queryClient.cancelQueries({ queryKey, exact: true });
        queryClient.setQueryData(queryKey, saved);
        void haptics.notification("success");
      })
      .catch((cause: unknown) => {
        setError(errorMessage(cause, t("mobile.server.providers.actionFailed")));
        void haptics.notification("error");
      })
      .finally(() => setSaving(false));
  };
  return { current, saving, error, choose };
}

/** The state of a provider's API key on the host, as the provider page and the key page show it. */
export function useProviderKeyState(serverId: string, admin: ProviderAdmin | null, provider: AgentProviderId | null) {
  const queryScope = useQueryScope();
  const queryKey = queryKeys.providerKey(queryScope, serverId, provider ?? "");
  return useQuery({
    queryKey,
    retry: false,
    staleTime: 0,
    gcTime: 0,
    queryFn: admin && provider ? () => admin.keyState(provider) : skipToken,
  });
}

/** The custom ACP agents of a host, as the Providers page and the custom agent page show them. */
export function useServerCustomAgents(serverId: string, admin: ProviderAdmin | null) {
  const queryScope = useQueryScope();
  const queryClient = useQueryClient();
  const queryKey = queryKeys.customAgents(queryScope, serverId);
  const keys = useRef(queryKey);
  keys.current = queryKey;
  const agents = admin?.customAgents;
  const list = useQuery({
    queryKey,
    retry: false,
    staleTime: 0,
    queryFn: agents ? () => agents.list() : skipToken,
  });
  const applyList = useCallback(
    async (next: CustomAgentSummary[]) => {
      await queryClient.cancelQueries({ queryKey: keys.current, exact: true });
      queryClient.setQueryData(keys.current, next);
    },
    [queryClient],
  );
  return { list, applyList };
}
