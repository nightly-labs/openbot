import type { AccountUsage, AgentStatus } from "@openbot/contracts/ipc";
import type { TextValue } from "@openbot/ui/text";
import { type Accessor, createEffect, createMemo, createSignal, onCleanup, untrack } from "solid-js";
import type { WebWorkspace } from "./web-client-context";

/**
 * The account usage reading of the connected host, for the page rail and the composer's usage-limit
 * notice. As on desktop, a reading is for one host and is taken again for each set of connected providers.
 */
export function createWebAccountUsage(options: {
  workspace: Pick<WebWorkspace, "state" | "runtime" | "onHostEvent">;
  status: Accessor<AgentStatus>;
  t: TextValue["t"];
}) {
  const { workspace, status } = options;
  const [accountUsage, setAccountUsage] = createSignal<AccountUsage | null>(null);
  let usageGeneration = 0;
  /** The host that the reading is for, while it is online. */
  const usageHostId = createMemo(() => {
    const hostId = workspace.state.host?.hostId;
    return hostId && workspace.runtime.accountUsage && workspace.state.status === "online" ? hostId : null;
  });
  /* As in the desktop dock: the reading is taken again when a provider connects or disconnects. */
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
  /** As on desktop: a provider still starts or checks its sign-in, so a new target and its reading follow. */
  const providersLoading = createMemo(() => {
    const current = status();
    return (
      current.phase === "starting" ||
      current.phase === "restarting" ||
      Boolean(current.providers?.some((item) => item.state === "checking" || item.connectionState === "connecting"))
    );
  });
  // As on desktop: a reading is for one host. On that host, the reading stays until the refresh for the new
  // target replaces it, so the rail rings do not blink while models load. It goes when no refresh follows.
  createEffect(usageHostId, () => {
    reset();
  });
  createEffect(
    () => usageReady() || providersLoading(),
    (refreshFollows) => {
      if (!refreshFollows) reset();
    },
  );
  // The composer shows the usage-limit notice with the Usage page closed, so read once for each target.
  // As on desktop, while a reading shows, the read waits for the provider checks to end.
  const hasReading = createMemo(() => (accountUsage()?.limits.length ?? 0) > 0);
  // An effect runs again each time its key is computed, so the key is a memo: the first reading
  // changes `hasReading`, and that alone must not read again.
  createEffect(
    createMemo(() => (usageReady() && !(hasReading() && providersLoading()) ? usageTargetKey() : null)),
    (target) => {
      if (target) void refreshUsage().catch(() => undefined);
    },
  );
  onCleanup(
    workspace.onHostEvent((event) => {
      // As on desktop: the host sends a new reading when a provider reports usage.
      if (event.type === "usage-changed" && untrack(usageTargetKey)) {
        usageGeneration += 1;
        setAccountUsage(event.usage);
      }
    }),
  );
  async function refreshUsage(): Promise<AccountUsage> {
    const readUsage = workspace.runtime.accountUsage;
    if (!readUsage || workspace.state.status !== "online") throw new Error(options.t("webClient.error.usageOffline"));
    const generation = ++usageGeneration;
    const usage = await readUsage();
    if (generation === usageGeneration) setAccountUsage(usage);
    return usage;
  }
  /** Drops the reading and any read in flight. */
  function reset(): void {
    usageGeneration += 1;
    setAccountUsage(null);
  }
  return { accountUsage, usageTargetKey, usageReady, refreshUsage, reset };
}
