import type { ServerSummary, StorageDisk } from "@openbot/contracts/ipc";
import { STORAGE_DISK_CAPABILITY } from "@openbot/contracts/team-protocol/storage-disk-v1";
import type { SidebarStorageLevel } from "@openbot/ui/features/sidebar/SidebarStorageCard";
import { createMemo, createSignal, untrack } from "solid-js";
import { createUsageRefreshPoll } from "../account/usage-refresh-poll";
import { canManageStorage } from "../files/storage-usage";
import { serverSupportsCapability } from "../servers/server-capabilities";
import { sidebarPort } from "./sidebar-port";

const GB = 1024 ** 3;

/** A closed "low" card stays closed on this computer, per server. "full" shows it again. */
const DISMISSED_KEY_PREFIX = "openbot:storage-card-dismissed:";

/**
 * "low" under 10% free, "full" under 2% free. A large disk uses 5 GB and 1 GB instead, so that a
 * 2 TB disk with 150 GB free does not show the card.
 */
function storageLevel(disk: StorageDisk): SidebarStorageLevel | null {
  const { freeBytes, totalBytes } = disk;
  if (freeBytes === null || totalBytes === null || totalBytes <= 0) return null;
  if (freeBytes < Math.min(totalBytes * 0.02, GB)) return "full";
  if (freeBytes < Math.min(totalBytes * 0.1, 5 * GB)) return "low";
  return null;
}

/** Reading `window.localStorage` throws when the browser blocks storage, so it is read inside the guard. */
function readDismissed(serverId: string): boolean {
  try {
    return window.localStorage.getItem(DISMISSED_KEY_PREFIX + serverId) === "true";
  } catch {
    return false;
  }
}

function writeDismissed(serverId: string, dismissed: boolean): void {
  try {
    if (dismissed) window.localStorage.setItem(DISMISSED_KEY_PREFIX + serverId, "true");
    else window.localStorage.removeItem(DISMISSED_KEY_PREFIX + serverId);
  } catch {
    // The card stays closed for this window when browser storage is unavailable.
  }
}

/**
 * The disk of the selected server, for the sidebar storage card. Only an owner or admin sees it,
 * because only they can free up space. A remote host without `storage-disk-v1` shows no card.
 */
export function createStorageCard(server: () => ServerSummary | undefined) {
  const [disk, setDisk] = createSignal<{ serverId: string; disk: StorageDisk } | null>(null);
  /** Changes on each close, so the card reads the saved choice again. */
  const [dismissals, setDismissals] = createSignal(0);
  const target = createMemo(() => {
    const current = server();
    return current && serverSupportsCapability(current, STORAGE_DISK_CAPABILITY) && canManageStorage(current)
      ? current.id
      : null;
  });

  function refresh(serverId: string): void {
    sidebarPort()
      .storage.getDisk(serverId)
      .then(
        (answer) => {
          // An answer for a server that is no longer selected is dropped.
          if (untrack(target) !== serverId) return;
          setDisk(answer ? { serverId, disk: answer } : null);
          // Space came back, so the next "low" shows the card again.
          if (answer && storageLevel(answer) === null) writeDismissed(serverId, false);
        },
        // A failed read shows no card. The next poll asks again.
        () => {
          if (untrack(target) === serverId) setDisk(null);
        },
      );
  }
  createUsageRefreshPoll({ target, refresh, refreshAtStart: true });

  return {
    /** The disk and level of the selected server, or null when the card is hidden. */
    card: createMemo(() => {
      const current = disk();
      if (!current || current.serverId !== target()) return null;
      const level = storageLevel(current.disk);
      const { freeBytes, totalBytes } = current.disk;
      if (!level || freeBytes === null || totalBytes === null) return null;
      dismissals();
      if (level === "low" && readDismissed(current.serverId)) return null;
      return { level, serverId: current.serverId, freeBytes, totalBytes };
    }),
    /** Reads the disk again, for example after Server settings freed up space. */
    refresh: () => {
      const serverId = target();
      if (serverId) refresh(serverId);
    },
    dismiss: (serverId: string) => {
      writeDismissed(serverId, true);
      setDismissals((count) => count + 1);
    },
  };
}
