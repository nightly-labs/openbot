import type { ServerSummary, StorageDisk } from "@openbot/contracts/ipc";
import { STORAGE_DISK_CAPABILITY } from "@openbot/contracts/team-protocol/storage-disk-v1";
import type { SidebarStorageLevel } from "@openbot/ui/features/sidebar/SidebarStorageCard";
import { createMemo, createSignal, untrack } from "solid-js";
import { createUsageRefreshPoll } from "../account/usage-refresh-poll";
import { canManageStorage, hostedPlanStorageGb, planDisk } from "../files/storage-usage";
import { serverSupportsCapability } from "../servers/server-capabilities";
import { type SidebarCardsPort, sidebarPort } from "./sidebar-port";

const GB = 1024 ** 3;

/** A closed "low" card stays closed on this computer, per server. "full" shows it again. */
const DISMISSED_KEY_PREFIX = "openbot:storage-card-dismissed:";

/**
 * "low" under 10% free, "full" under 2% free. A large disk uses 5 GB and 1 GB instead, so that a
 * 2 TB disk with 150 GB free does not show the card.
 *
 * A hosted server is measured against its plan, which keeps 10 GB in reserve: "low" when less than
 * 10 GB of the plan is free (20% of a small plan), "full" when less than 1 GB is free (2% of a small
 * plan). For example, a 50 GB plan is "low" at 40 GB used.
 */
function storageLevel(disk: StorageDisk, storageGb: number | null): SidebarStorageLevel | null {
  const { freeBytes, totalBytes } = storageGb === null ? disk : planDisk(disk, storageGb);
  if (freeBytes === null || totalBytes === null || totalBytes <= 0) return null;
  if (freeBytes < Math.min(totalBytes * 0.02, GB)) return "full";
  if (freeBytes < (storageGb === null ? Math.min(totalBytes * 0.1, 5 * GB) : Math.min(totalBytes * 0.2, 10 * GB)))
    return "low";
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
 * The highest level at which the upgrade dialog showed for each server, on this computer. The dialog
 * shows once at "low" and once more at "full". When space comes back, the record is cleared.
 */
const UPGRADE_OFFERED_KEY_PREFIX = "openbot:server-upgrade-offered:";

export function readUpgradeOffered(serverId: string): SidebarStorageLevel | null {
  try {
    const value = window.localStorage.getItem(UPGRADE_OFFERED_KEY_PREFIX + serverId);
    return value === "low" || value === "full" ? value : null;
  } catch {
    return null;
  }
}

/** False when browser storage is unavailable. The dialog then does not show, so it cannot repeat. */
export function writeUpgradeOffered(serverId: string, level: SidebarStorageLevel): boolean {
  try {
    window.localStorage.setItem(UPGRADE_OFFERED_KEY_PREFIX + serverId, level);
    return true;
  } catch {
    return false;
  }
}

function clearUpgradeOffered(serverId: string): void {
  try {
    window.localStorage.removeItem(UPGRADE_OFFERED_KEY_PREFIX + serverId);
  } catch {
    // The record stays, and the dialog shows again only at a higher level.
  }
}

/**
 * The disk of the selected server, for the sidebar storage card. Only an owner or admin sees it,
 * because only they can free up space. A remote host without `storage-disk-v1` shows no card.
 * A hosted server shows its plan storage, not its disk.
 */
export function createStorageCard(server: () => ServerSummary | undefined, port: () => SidebarCardsPort = sidebarPort) {
  const [disk, setDisk] = createSignal<{ serverId: string; disk: StorageDisk } | null>(null);
  const storageGb = createMemo(() => hostedPlanStorageGb(server()));
  /** Changes on each close, so the card reads the saved choice again. */
  const [dismissals, setDismissals] = createSignal(0);
  const target = createMemo(() => {
    const current = server();
    return current && serverSupportsCapability(current, STORAGE_DISK_CAPABILITY) && canManageStorage(current)
      ? current.id
      : null;
  });

  function refresh(serverId: string): void {
    port()
      .storage.getDisk(serverId)
      .then(
        (answer) => {
          // An answer for a server that is no longer selected is dropped.
          if (untrack(target) !== serverId) return;
          setDisk(answer ? { serverId, disk: answer } : null);
          // Space came back, so the next "low" shows the card and offers the upgrade again.
          if (answer && storageLevel(answer, untrack(storageGb)) === null) {
            writeDismissed(serverId, false);
            clearUpgradeOffered(serverId);
          }
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
      const plan = storageGb();
      const level = storageLevel(current.disk, plan);
      const { freeBytes, totalBytes } = plan === null ? current.disk : planDisk(current.disk, plan);
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
