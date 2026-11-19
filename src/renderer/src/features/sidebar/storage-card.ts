import { hostedPlanDisk } from "@openbot/contracts/hosted-servers";
import type { ServerSummary, StorageDisk } from "@openbot/contracts/ipc";
import { STORAGE_DISK_CAPABILITY } from "@openbot/contracts/team-protocol/storage-disk-v1";
import type { SidebarStorageLevel } from "@openbot/ui/features/sidebar/SidebarStorageCard";
import { createMemo, createSignal, untrack } from "solid-js";
import { createUsageRefreshPoll } from "../account/usage-refresh-poll";
import { canManageStorage, hostedPlanStorageGb } from "../files/storage-usage";
import { serverSupportsCapability } from "../servers/server-capabilities";
import { type SidebarCardsPort, sidebarPort } from "./sidebar-port";

const GB = 1024 ** 3;

const DISMISSED_KEY_PREFIX = "openbot:storage-card-dismissed:";

function storageLevel(disk: StorageDisk, storageGb: number | null): SidebarStorageLevel | null {
  const { freeBytes, totalBytes } = storageGb === null ? disk : hostedPlanDisk(disk, storageGb);
  if (freeBytes === null || totalBytes === null || totalBytes <= 0) return null;
  if (freeBytes < Math.min(totalBytes * 0.02, GB)) return "full";
  if (freeBytes < (storageGb === null ? Math.min(totalBytes * 0.1, 5 * GB) : Math.min(totalBytes * 0.2, 10 * GB)))
    return "low";
  return null;
}

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
  } catch {}
}

const UPGRADE_OFFERED_KEY_PREFIX = "openbot:server-upgrade-offered:";

export function readUpgradeOffered(serverId: string): SidebarStorageLevel | null {
  try {
    const value = window.localStorage.getItem(UPGRADE_OFFERED_KEY_PREFIX + serverId);
    return value === "low" || value === "full" ? value : null;
  } catch {
    return null;
  }
}

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
  } catch {}
}

export function createStorageCard(server: () => ServerSummary | undefined, port: () => SidebarCardsPort = sidebarPort) {
  const [disk, setDisk] = createSignal<{ serverId: string; disk: StorageDisk } | null>(null);
  const storageGb = createMemo(() => hostedPlanStorageGb(server()));
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
          if (untrack(target) !== serverId) return;
          setDisk(answer ? { serverId, disk: answer } : null);
          if (answer && storageLevel(answer, untrack(storageGb)) === null) {
            writeDismissed(serverId, false);
            clearUpgradeOffered(serverId);
          }
        },
        () => {
          if (untrack(target) === serverId) setDisk(null);
        },
      );
  }
  createUsageRefreshPoll({ target, refresh, refreshAtStart: true });

  return {
    card: createMemo(() => {
      const current = disk();
      if (!current || current.serverId !== target()) return null;
      const plan = storageGb();
      const level = storageLevel(current.disk, plan);
      const { freeBytes, totalBytes } = plan === null ? current.disk : hostedPlanDisk(current.disk, plan);
      if (!level || freeBytes === null || totalBytes === null) return null;
      dismissals();
      if (level === "low" && readDismissed(current.serverId)) return null;
      return { level, serverId: current.serverId, freeBytes, totalBytes };
    }),
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
