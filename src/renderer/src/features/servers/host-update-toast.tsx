import type { HostUpdateStatus } from "@openbot/contracts/ipc";
import { Progress, toast } from "@openbot/ui";
import { currentText } from "@openbot/ui/text";
import { createRoot, createSignal } from "solid-js";
import type { HostUpdateCalls } from "./ServerUpdatePanel";

/**
 * The OpenBot update of a joined host, as notices for its admins (`host-update-v1`): an offer when a
 * new version is available, and a live percentage while the host downloads it. The host sends no
 * progress event, so a download is read again each second. The notices outlive Server Settings,
 * which is why this module keeps its own state instead of the panel's.
 *
 * The progress toast is raised once and changes in place, as `provider-update-toast.tsx` explains:
 * a second `toast()` with the same id mounts a new row, and the toast jumps.
 */

export interface HostUpdateWatch {
  serverId: string;
  name: string;
  calls: Pick<HostUpdateCalls, "getUpdateStatus">;
  /** Opens Server Settings > Updates for this host. */
  openUpdates?: () => void;
  /** False when another notice already offers the update, such as the version mismatch notice. */
  offer?: boolean;
}

const POLL_MS = 1000;

interface Watch {
  generation: number;
  timer: ReturnType<typeof setTimeout> | undefined;
  live: { show: (status: HostUpdateStatus) => void; dispose: () => void } | null;
}

const watches = new Map<string, Watch>();
/** `serverId:version` of each offer this session showed. An offer is made once per version. */
const offered = new Set<string>();

const progressId = (serverId: string) => `host-update-progress:${serverId}`;
const offerId = (serverId: string) => `host-update-offer:${serverId}`;

function downloading(status: HostUpdateStatus): boolean {
  return status.phase === "checking" || status.phase === "downloading";
}

/**
 * Reads the host's update status and shows what an admin must know about it. Pass the status that an
 * action just answered to skip the first read. A new call for the same host replaces the last one.
 */
export function watchHostUpdate(options: HostUpdateWatch, status?: HostUpdateStatus): void {
  const watch = watches.get(options.serverId) ?? { generation: 0, timer: undefined, live: null };
  watches.set(options.serverId, watch);
  watch.generation += 1;
  if (watch.timer !== undefined) clearTimeout(watch.timer);
  watch.timer = undefined;
  const generation = watch.generation;
  const read = async (): Promise<void> => {
    try {
      const next = await options.calls.getUpdateStatus(options.serverId);
      if (watch.generation === generation) apply(next);
    } catch {
      // A host that restarts or goes offline cannot answer; the restart notice explains that.
      if (watch.generation === generation) stop(options.serverId);
    }
  };
  const apply = (next: HostUpdateStatus): void => {
    if (downloading(next)) {
      showProgress(options, watch, next);
      watch.timer = setTimeout(() => void read(), POLL_MS);
      return;
    }
    const hadProgress = watch.live !== null;
    stop(options.serverId);
    if (hadProgress && next.phase === "error")
      toast.error(currentText().t("server.update.status.downloadFailed", { name: options.name }));
    // An admin who cannot start the update gets no offer.
    else if (
      next.remoteUpdates === "allowed" &&
      !next.restart &&
      next.availableVersion &&
      (next.phase === "available" || next.phase === "ready")
    )
      offerUpdate(options, next.availableVersion, next.currentVersion);
  };
  if (status) apply(status);
  else void read();
}

function stop(serverId: string): void {
  const watch = watches.get(serverId);
  if (!watch) return;
  watch.generation += 1;
  if (watch.timer !== undefined) clearTimeout(watch.timer);
  watch.timer = undefined;
  watch.live?.dispose();
  watch.live = null;
  toast.dismiss(progressId(serverId));
}

function offerUpdate(options: HostUpdateWatch, version: string, current: string): void {
  const key = `${options.serverId}:${version}`;
  if (options.offer === false || offered.has(key)) return;
  offered.add(key);
  const { t } = currentText();
  const open = options.openUpdates;
  toast.info(t("server.update.availableTitle", { name: options.name }), {
    id: offerId(options.serverId),
    description: t("server.update.availableDescription", { name: options.name, version, current }),
    // Made once per version, so it stays until the admin closes it or starts the update.
    duration: Number.POSITIVE_INFINITY,
    action: open ? { label: t("server.update.hostAction"), onClick: () => open() } : undefined,
  });
}

function showProgress(options: HostUpdateWatch, watch: Watch, status: HostUpdateStatus): void {
  if (watch.live) {
    watch.live.show(status);
    return;
  }
  toast.dismiss(offerId(options.serverId));
  // An explicit root: the caller can be an effect whose next run would dispose these elements. The
  // toast is raised outside the root, because a write to the Toaster from a plain owner throws.
  const parts = createRoot((dispose) => {
    const [current, setCurrent] = createSignal(status);
    const text = () => {
      const { t, format } = currentText();
      const now = current();
      const version = now.availableVersion ?? now.currentVersion;
      return now.phase === "checking"
        ? t("server.update.status.checking")
        : t("server.update.status.downloading", { version, progress: format.percent((now.progress ?? 0) / 100) });
    };
    return {
      show: setCurrent,
      dispose,
      description: (
        // The layout of the provider update notice, so both downloads read the same.
        <>
          <span class="provider-update-toast-line">{text()}</span>
          <span class="provider-update-toast-progress">
            <Progress
              class="provider-update-toast-bar"
              value={current().progress ?? 0}
              indeterminate={current().progress === null}
              aria-label={currentText().t("server.update.progressTitle", { name: options.name })}
            />
          </span>
        </>
      ),
    };
  });
  watch.live = { show: parts.show, dispose: parts.dispose };
  toast(currentText().t("server.update.progressTitle", { name: options.name }), {
    id: progressId(options.serverId),
    description: parts.description,
    duration: Number.POSITIVE_INFINITY,
    onDismiss: () => {
      // The user closed it: stop reading. A close made here disposed the parts first.
      if (watch.live?.dispose === parts.dispose) stop(options.serverId);
    },
  });
}
