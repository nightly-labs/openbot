import type { AccountUsage, AgentStatus } from "@openbot/contracts/ipc";
import type { TextValue } from "@openbot/ui/text";
import { type Accessor, createEffect, createMemo, createSignal, onCleanup, untrack } from "solid-js";
import type { WebWorkspace } from "./web-client-context";

/**
 * The account usage reading of the connected host, for the account dock and the composer's usage-limit
 * notice. As on desktop, a reading is for one host and one set of connected providers.
 */
export function createWebAccountUsage(options: {
  workspace: Pick<WebWorkspace, "state" | "runtime" | "onHostEvent">;
  status: Accessor<AgentStatus>;
  t: TextValue["t"];
}) {
  const { workspace, status } = options;
  const [accountUsage, setAccountUsage] = createSignal<AccountUsage | null>(null);
  let usageGeneration = 0;
  /* As in the desktop dock: the reading is taken again when a provider connects or disconnects. */
  const usageTargetKey = createMemo(() => {
    const hostId = workspace.state.host?.hostId;
    if (!hostId || !workspace.runtime.accountUsage || workspace.state.status !== "online") return null;
    const connected = (status().providers ?? [])
      .filter((item) => item.state === "available" && item.connectionState !== "connecting")
      .map((item) => item.id)
      .sort()
      .join(",");
    return `${hostId}:${connected}`;
  });
  // As on desktop: a reading is for one host and one set of connected providers.
  createEffect(usageTargetKey, () => {
    setAccountUsage(null);
  });
  const usageReady = createMemo(() => {
    const current = status();
    return (
      workspace.state.status === "online" &&
      (current.phase === "ready" ||
        Boolean(current.providers?.some((item) => item.state === "available" && item.connectionState !== "connecting")))
    );
  });
  // The composer shows the usage-limit notice with the account menu closed, so read once for each target.
  createEffect(
    () => (usageReady() ? usageTargetKey() : null),
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
  /** Drops the reading and any read in flight, for a host change. */
  function reset(): void {
    usageGeneration += 1;
    setAccountUsage(null);
  }
  return { accountUsage, usageTargetKey, usageReady, refreshUsage, reset };
}
