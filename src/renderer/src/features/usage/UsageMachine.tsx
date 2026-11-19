import { hostedPlanMachineMetrics } from "@openbot/contracts/hosted-servers";
import type { MachineMetrics, OpenBotDesktopApi } from "@openbot/contracts/ipc";
import { MACHINE_RESOURCES_CAPABILITY } from "@openbot/contracts/team-protocol/machine-resources-v1";
import { STORAGE_USER_FILES_CAPABILITY } from "@openbot/contracts/team-protocol/storage-user-files-v1";
import { UsageMachineMeter } from "@openbot/ui/features/usage/UsageMachineMeter";
import { createMemo, createSignal, Show, untrack } from "solid-js";
import { createUsageRefreshPoll } from "../account/usage-refresh-poll";
import { canManageStorage, hostedPlanStorageGb } from "../files/storage-usage";
import { serverSupportsCapability } from "../servers/server-capabilities";
import { useServerSettings } from "../servers/server-settings";
import { useServers } from "../servers/servers-context";

const MACHINE_REFRESH_MS = 5_000;
const MACHINE_REFRESH_CHECK_MS = 1_000;
const USER_FILES_REFRESH_MS = 60_000;
const USER_FILES_REFRESH_CHECK_MS = 5_000;

type MachinePort = Pick<OpenBotDesktopApi["storage"], "getMachineMetrics" | "getDisk">;

function machinePort(): MachinePort {
  return window.openbot.storage;
}

export function UsageMachine(props: { serverId: string }) {
  const { servers } = useServers();
  const { openServerSettings } = useServerSettings();
  const server = createMemo(() => servers().find((candidate) => candidate.id === props.serverId));
  const target = createMemo(() => {
    const current = server();
    return current && serverSupportsCapability(current, MACHINE_RESOURCES_CAPABILITY) && canManageStorage(current)
      ? current.id
      : null;
  });
  const storageGb = createMemo(() => hostedPlanStorageGb(server()));
  const userFilesTarget = createMemo(() => {
    const current = server();
    return storageGb() !== null && current && serverSupportsCapability(current, STORAGE_USER_FILES_CAPABILITY)
      ? target()
      : null;
  });
  const [reading, setReading] = createSignal<{ serverId: string; metrics: MachineMetrics } | null>(null);
  const [userFiles, setUserFiles] = createSignal<{ serverId: string; bytes: number | null } | null>(null);
  let pending: string | null = null;

  function refresh(serverId: string): void {
    if (pending === serverId) return;
    pending = serverId;
    machinePort()
      .getMachineMetrics(serverId)
      .finally(() => {
        if (pending === serverId) pending = null;
      })
      .then(
        (metrics) => {
          if (untrack(target) === serverId) setReading(metrics ? { serverId, metrics } : null);
        },
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

  let userFilesPending: string | null = null;
  function refreshUserFiles(serverId: string): void {
    if (userFilesPending === serverId) return;
    userFilesPending = serverId;
    machinePort()
      .getDisk(serverId)
      .finally(() => {
        if (userFilesPending === serverId) userFilesPending = null;
      })
      .then(
        (disk) => disk?.userBytes ?? null,
        () => {
          const last = untrack(userFiles);
          return last?.serverId === serverId ? last.bytes : null;
        },
      )
      .then((bytes) => {
        if (untrack(userFilesTarget) === serverId) setUserFiles({ serverId, bytes });
      });
  }
  createUsageRefreshPoll({
    target: userFilesTarget,
    refresh: refreshUserFiles,
    refreshAtStart: true,
    refreshMs: USER_FILES_REFRESH_MS,
    checkMs: USER_FILES_REFRESH_CHECK_MS,
  });

  const shown = () => {
    const current = reading();
    if (!current || current.serverId !== target()) return null;
    const plan = storageGb();
    if (plan === null) return current;
    const files = userFiles();
    const read = files?.serverId === current.serverId ? files : null;
    if (userFilesTarget() !== null && !read)
      return {
        serverId: current.serverId,
        metrics: { ...current.metrics, diskUsedBytes: null, diskFreeBytes: null, diskTotalBytes: null },
      };
    return {
      serverId: current.serverId,
      metrics: hostedPlanMachineMetrics(current.metrics, plan, read?.bytes ?? null),
    };
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
