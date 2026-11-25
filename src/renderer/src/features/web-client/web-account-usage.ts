import { type AccountUsage, type AgentStatus, keepUsageCredits, withReadCredits } from "@openbot/contracts/ipc";
import type { TextValue } from "@openbot/ui/text";
import { type Accessor, createEffect, createMemo, createSignal, onCleanup, untrack } from "solid-js";
import type { WebWorkspace } from "./web-client-context";

export function createWebAccountUsage(options: {
  workspace: Pick<WebWorkspace, "state" | "runtime" | "onHostEvent">;
  status: Accessor<AgentStatus>;
  t: TextValue["t"];
}) {
  const { workspace, status } = options;
  const [accountUsage, setAccountUsage] = createSignal<AccountUsage | null>(null);
  let usageGeneration = 0;
  let usageResets = 0;
  let usageReads = 0;
  const usageHostId = createMemo(() => {
    const hostId = workspace.state.host?.hostId;
    return hostId && workspace.runtime.accountUsage && workspace.state.status === "online" ? hostId : null;
  });
  const usageTargetKey = createMemo(() => {
    const hostId = usageHostId();
    if (!hostId) return null;
    const connected = (status().providers ?? [])
      .filter((item) => item.state === "available" && item.connectionState !== "connecting")
      .map((item) => item.id)
      .sort()
      .join(",");
    return `${hostId}:${connected}`;
  });
  const usageReady = createMemo(() => {
    const current = status();
    return (
      workspace.state.status === "online" &&
      (current.phase === "ready" ||
        Boolean(current.providers?.some((item) => item.state === "available" && item.connectionState !== "connecting")))
    );
  });
  const providersLoading = createMemo(() => {
    const current = status();
    return (
      current.phase === "starting" ||
      current.phase === "restarting" ||
      Boolean(current.providers?.some((item) => item.state === "checking" || item.connectionState === "connecting"))
    );
  });
  createEffect(usageHostId, () => {
    reset();
  });
  createEffect(
    () => usageReady() || providersLoading(),
    (refreshFollows) => {
      if (!refreshFollows) reset();
    },
  );
  const hasReading = createMemo(() => accountUsage()?.limits.some((limit) => limit.readFailed !== true) ?? false);
  createEffect(
    createMemo(() => (usageReady() && !(hasReading() && providersLoading()) ? usageTargetKey() : null)),
    (target) => {
      if (target) void refreshUsage().catch(() => undefined);
    },
  );
  onCleanup(
    workspace.onHostEvent((event) => {
      if (event.type === "usage-changed" && untrack(usageTargetKey)) {
        usageGeneration += 1;
        setAccountUsage((current) => ({
          limits: event.usage.limits.map((limit) =>
            keepUsageCredits(
              current?.limits.find((kept) => kept.id === limit.id && kept.accountId === limit.accountId),
              limit,
            ),
          ),
        }));
      }
      if (event.type === "usage-credits-changed" && untrack(usageTargetKey)) void refreshUsage().catch(() => undefined);
    }),
  );
  async function refreshUsage(): Promise<AccountUsage> {
    const readUsage = workspace.runtime.accountUsage;
    if (!readUsage || workspace.state.status !== "online") throw new Error(options.t("webClient.error.usageOffline"));
    const generation = ++usageGeneration;
    const resets = usageResets;
    const read = ++usageReads;
    const usage = await readUsage();
    if (generation === usageGeneration) setAccountUsage(usage);
    else if (resets === usageResets && read === usageReads)
      setAccountUsage((current) =>
        current
          ? {
              limits: current.limits.map((limit) =>
                withReadCredits(
                  usage.limits.find((read) => read.id === limit.id && read.accountId === limit.accountId),
                  limit,
                ),
              ),
            }
          : current,
      );
    return usage;
  }
  function reset(): void {
    usageGeneration += 1;
    usageResets += 1;
    setAccountUsage(null);
  }
  return { accountUsage, usageTargetKey, usageReady, refreshUsage, reset };
}
