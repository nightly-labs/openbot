import type { MachineMetrics, OpenBotDesktopApi } from "@openbot/contracts/ipc";
import { MACHINE_RESOURCES_CAPABILITY } from "@openbot/contracts/team-protocol/machine-resources-v1";
import { UsageMachineMeter } from "@openbot/ui/features/usage/UsageMachineMeter";
import { createMemo, createSignal, Show, untrack } from "solid-js";
import { createUsageRefreshPoll } from "../account/usage-refresh-poll";
import { canManageStorage } from "../files/storage-usage";
import { serverSupportsCapability } from "../servers/server-capabilities";
import { useServerSettings } from "../servers/server-settings";
import { useServers } from "../servers/servers-context";

/** Memory and CPU change fast, and the host reads CPU since the reading before. */
const MACHINE_REFRESH_MS = 60_000;
/** The poll compares the age often, so a reading is at most this much later than the minute. */
const MACHINE_REFRESH_CHECK_MS = 10_000;

type MachinePort = Pick<OpenBotDesktopApi["storage"], "getMachineMetrics">;

/** Read on each call: tests and stories replace `window.openbot` per case. */
function machinePort(): MachinePort {
  return window.openbot.storage;
}

/**
 * The machine use of a server in the Usage header. Only an owner or admin reads the machine, and only
 * on a host with `machine-resources-v1`; for others it shows nothing. It reads each minute while the
 * window is visible, and at once when the window shows again after a minute or more.
 */
export function UsageMachine(props: { serverId: string }) {
  const { servers } = useServers();
  const { openServerSettings } = useServerSettings();
  const target = createMemo(() => {
    const server = servers().find((candidate) => candidate.id === props.serverId);
    return server && serverSupportsCapability(server, MACHINE_RESOURCES_CAPABILITY) && canManageStorage(server)
      ? server.id
      : null;
  });
  const [reading, setReading] = createSignal<{ serverId: string; metrics: MachineMetrics } | null>(null);

  function refresh(serverId: string): void {
    machinePort()
      .getMachineMetrics(serverId)
      .then(
        (metrics) => {
          // An answer for a server that the panel no longer shows is dropped.
          if (untrack(target) === serverId) setReading(metrics ? { serverId, metrics } : null);
        },
        // A failed read shows no meter, so an old reading does not look live. The next poll asks again.
        () => {
          if (untrack(target) === serverId) setReading(null);
        },
      );
  }
  createUsageRefreshPoll({
    target,
    refresh,
    refreshAtStart: true,
    refreshMs: MACHINE_REFRESH_MS,
    checkMs: MACHINE_REFRESH_CHECK_MS,
  });

  /** A reading of a server that the panel showed before does not show. */
  const shown = () => {
    const current = reading();
    return current && current.serverId === target() ? current : null;
  };

  return (
    <Show when={shown()}>
      {(current) => (
        <UsageMachineMeter
          metrics={current().metrics}
          onOpenStorage={() => openServerSettings(current().serverId, null, "storage")}
        />
      )}
    </Show>
  );
}
