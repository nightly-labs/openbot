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

/** Memory and CPU change fast, so the meter is live. The host reads CPU since the reading before. */
const MACHINE_REFRESH_MS = 5_000;
/** The poll compares the age often, so a reading is at most this much later than its interval. */
const MACHINE_REFRESH_CHECK_MS = 1_000;
/** The host measures the files of the users at most every 10 minutes, so their size is read less often. */
const USER_FILES_REFRESH_MS = 60_000;
const USER_FILES_REFRESH_CHECK_MS = 5_000;

type MachinePort = Pick<OpenBotDesktopApi["storage"], "getMachineMetrics" | "getDisk">;

/** Read on each call: tests and stories replace `window.openbot` per case. */
function machinePort(): MachinePort {
  return window.openbot.storage;
}

/**
 * The machine use of a server in the Usage header. Only an owner or admin reads the machine, and only
 * on a host with `machine-resources-v1`; for others it shows nothing. It reads every few seconds while
 * the window is visible, and at once when the window shows again.
 *
 * A hosted server shows its disk against the plan storage, as Server settings > Storage does: its VPS
 * disk is much larger than the plan. Until the size of the users' files comes, the disk shows as unknown.
 */
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
  /**
   * The server whose users' files the meter reads. Null on a server without a plan, and on a host that
   * does not measure them: there the plan storage counts them from the free space.
   */
  const userFilesTarget = createMemo(() => {
    const current = server();
    return storageGb() !== null && current && serverSupportsCapability(current, STORAGE_USER_FILES_CAPABILITY)
      ? target()
      : null;
  });
  const [reading, setReading] = createSignal<{ serverId: string; metrics: MachineMetrics } | null>(null);
  const [userFiles, setUserFiles] = createSignal<{ serverId: string; bytes: number | null } | null>(null);
  /** A slow remote host does not get a second read of the same server before it answers the first. */
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
        // A failed read keeps the last size. Without one, the plan storage counts them from the free space.
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

  /** A reading of a server that the panel showed before does not show. */
  const shown = () => {
    const current = reading();
    if (!current || current.serverId !== target()) return null;
    const plan = storageGb();
    if (plan === null) return current;
    const files = userFiles();
    const read = files?.serverId === current.serverId ? files : null;
    // The first answer can take some seconds. Until it comes, the disk is unknown and CPU and memory show.
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
          hostedPlan={storageGb() !== null}
          onOpenStorage={() => openServerSettings(current().serverId, null, "storage")}
        />
      )}
    </Show>
  );
}
