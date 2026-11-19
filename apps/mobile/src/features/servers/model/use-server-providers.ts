import type {
  AgentProviderId,
  AgentStatus,
  CustomAgentSummary,
  CustomProviderSummary,
  ProviderRuntimeSnapshot,
} from "@openbot/contracts/ipc";
import { type QueryKey, skipToken, useQuery, useQueryClient } from "@tanstack/react-query";
import { useCallback, useMemo, useRef, useState } from "react";
import { useQueryScope } from "@/features/auth/context/mobile-session-context";
import { type ProviderAdmin, providerRows } from "@/features/servers/model/provider-admin";
import { useMobileWorkspace, useMobileWorkspaceActions } from "@/features/workspace/context/mobile-workspace-context";
import { queryKeys } from "@/features/workspace/model/query-keys";
import { haptics } from "@/shared/lib/haptics";
import { useText } from "@/shared/lib/text";

const RUNTIME_POLL_MS = 1000;
const STATUS_POLL_MS = 3000;

export function useProviderAdmin(serverId: string) {
  const { canManageProviders } = useMobileWorkspace();
  const { providerAdmin } = useMobileWorkspaceActions();
  const available = canManageProviders(serverId);
  const admin = useMemo(() => (available ? providerAdmin(serverId) : null), [available, providerAdmin, serverId]);
  return { available, admin };
}

export function useServerProviders(serverId: string, options: { watchStatus?: boolean } = {}) {
  const { available, admin } = useProviderAdmin(serverId);
  const queryScope = useQueryScope();
  const queryClient = useQueryClient();
  const statusKey = queryKeys.providerStatus(queryScope, serverId);
  const runtimesKey = queryKeys.providerRuntimes(queryScope, serverId);
  const keys = useRef({ statusKey, runtimesKey });
  keys.current = { statusKey, runtimesKey };
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

export function useServerCustomProviders(serverId: string, admin: ProviderAdmin | null) {
  const queryScope = useQueryScope();
  const queryClient = useQueryClient();
  const queryKey = queryKeys.customProviders(queryScope, serverId, Boolean(admin?.updateCustom));
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

export function useHostProviderDefault(serverId: string, setting: ProviderAdmin["defaultProvider"]) {
  const queryScope = useQueryScope();
  const { current, saving, error, save } = useProviderSetting(queryKeys.providerDefault(queryScope, serverId), setting);
  const choose = (provider: AgentProviderId) => {
    if (!setting || saving || provider === current.data?.provider) return;
    save(provider);
  };
  return { current, saving, error, choose };
}

export function useProviderSetting<T, V>(
  queryKey: QueryKey,
  setting: { read: () => Promise<T>; set: (value: V) => Promise<T> } | null,
) {
  const { t, errorMessage } = useText();
  const queryClient = useQueryClient();
  const current = useQuery({
    queryKey,
    retry: false,
    staleTime: 0,
    queryFn: setting ? () => setting.read() : skipToken,
  });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const save = (value: V) => {
    if (!setting) return;
    setSaving(true);
    setError(null);
    setting
      .set(value)
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
  return { current, saving, error, save };
}

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
