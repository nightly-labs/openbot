import type { MachineMetrics, OpenBotDesktopApi } from "@openbot/contracts/ipc";
import { MACHINE_RESOURCES_CAPABILITY } from "@openbot/contracts/team-protocol/machine-resources-v1";
import { UsageMachineMeter } from "@openbot/ui/features/usage/UsageMachineMeter";
import { createEffect, createMemo, createSignal, Show, untrack } from "solid-js";
import { canManageStorage } from "../files/storage-usage";
import { serverSupportsCapability } from "../servers/server-capabilities";
import { useServerSettings } from "../servers/server-settings";
import { useServers } from "../servers/servers-context";

/** Memory and CPU change fast, and the host reads CPU since the reading before. */
const MACHINE_REFRESH_MS = 60_000;
/** A timer can fire a little early, so a reading this close to the interval is due. */
const MACHINE_REFRESH_SLACK_MS = 1_000;

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

  createEffect(target, (serverId) => {
    if (!serverId) return;
    let current = true;
    let lastReadAt = 0;
    const read = () => {
      lastReadAt = Date.now();
      machinePort()
        .getMachineMetrics(serverId)
        .then(
          (metrics) => {
            if (current) setReading(metrics ? { serverId, metrics } : null);
          },
          // The meter keeps the last reading. The next minute asks again.
          () => undefined,
        );
    };
    const readWhenDue = () => {
      if (document.hidden || Date.now() - lastReadAt < MACHINE_REFRESH_MS - MACHINE_REFRESH_SLACK_MS) return;
      read();
    };
    untrack(read);
    const timer = window.setInterval(readWhenDue, MACHINE_REFRESH_MS);
    document.addEventListener("visibilitychange", readWhenDue);
    return () => {
      current = false;
      window.clearInterval(timer);
      document.removeEventListener("visibilitychange", readWhenDue);
    };
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
