import { createEffect, createMemo, untrack } from "solid-js";
import { useAgents } from "../agents/agents-context";
import { useServers } from "../servers/servers-context";
import { useAuth } from "./account-context";
import { createUsageRefreshPoll } from "./usage-refresh-poll";

export function useAccountUsagePolling() {
  const auth = useAuth();
  const { agentStatus, refreshHostAccountUsage } = useAgents();
  const { activeServerId } = useServers();
  const usageReady = createMemo(() => {
    const status = agentStatus();
    return (
      status.phase === "ready" ||
      Boolean(status.providers?.some((item) => item.state === "available" && item.connectionState !== "connecting"))
    );
  });
  const usageTargetKey = createMemo(() => {
    const serverId = activeServerId();
    if (!serverId) return null;
    const connected = (agentStatus().providers ?? [])
      .filter((item) => item.state === "available" && item.connectionState !== "connecting")
      .map((item) => item.id)
      .sort()
      .join(",");
    return `${serverId}:${connected}`;
  });
  const providersLoading = createMemo(() => {
    const status = agentStatus();
    return (
      status.phase === "starting" ||
      status.phase === "restarting" ||
      Boolean(status.providers?.some((item) => item.state === "checking" || item.connectionState === "connecting"))
    );
  });
  let selectedServerId: string | null = null;

  createEffect(
    () => usageTargetKey(),
    (targetKey) =>
      untrack(() => {
        const serverId = activeServerId() ?? null;
        if (serverId !== selectedServerId) auth.invalidateAccountUsage();
        selectedServerId = serverId;
        auth.selectAccountUsageTarget(targetKey);
      }),
  );
  createEffect(
    () => usageReady() || providersLoading(),
    (refreshFollows) => {
      if (!refreshFollows) untrack(auth.invalidateAccountUsage);
    },
  );

  const hasReading = createMemo(() => (auth.accountUsage()?.limits.length ?? 0) > 0);
  createUsageRefreshPoll({
    target: () => (usageReady() && !(hasReading() && providersLoading()) ? usageTargetKey() : null),
    refreshAtStart: true,
    refresh: (targetKey) => {
      void refreshHostAccountUsage().catch(() => undefined);
      void auth.refreshAccountUsage(targetKey).catch(() => undefined);
    },
  });
}
