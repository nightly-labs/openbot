import { normalizeSidebarPinnedItems, type SidebarPinnedItem } from "@openbot/ui/features/sidebar/sidebar-pins";
import { z } from "zod";
export type SidebarPinsByServer = Record<string, SidebarPinnedItem[]>;

const SIDEBAR_PINS_STORAGE_KEY = "openbot:sidebar-pins:v1";

type SidebarPinStorage = Pick<Storage, "getItem" | "setItem">;

const sidebarPinnedItemSchema = z.object({
  kind: z.enum(["agent", "channel", "person"]),
  id: z.string().trim().min(1),
});
const sidebarPinsSchema = z.record(
  z.string().trim().min(1),
  z.array(sidebarPinnedItemSchema.nullable().catch(null)).catch([]),
);

export function readSidebarPins(storage: SidebarPinStorage = window.localStorage): SidebarPinsByServer {
  try {
    const parsed = sidebarPinsSchema.safeParse(JSON.parse(storage.getItem(SIDEBAR_PINS_STORAGE_KEY) ?? "{}"));
    if (!parsed.success) return {};
    return Object.fromEntries(
      Object.entries(parsed.data).flatMap(([serverId, items]) => {
        const normalized = normalizeSidebarPinnedItems(items.flatMap((item) => (item ? [item] : [])));
        return serverId.trim() && normalized.length > 0 ? [[serverId, normalized]] : [];
      }),
    );
  } catch {
    return {};
  }
}

export function writeSidebarPins(
  pinsByServer: SidebarPinsByServer,
  storage: SidebarPinStorage = window.localStorage,
): void {
  try {
    storage.setItem(SIDEBAR_PINS_STORAGE_KEY, JSON.stringify(pinsByServer));
  } catch {
    // A UI preference must not block navigation when browser storage is unavailable.
  }
}

const SIDEBAR_PINS_PENDING_STORAGE_KEY = "openbot:sidebar-pins-pending:v1";

const pendingSchema = z.array(z.string().trim().min(1).nullable().catch(null)).catch([]);

/** The scopes whose last pin change has not reached their server yet. */
export function readPendingSidebarPinScopes(storage: SidebarPinStorage = window.localStorage): Set<string> {
  try {
    const parsed = pendingSchema.safeParse(JSON.parse(storage.getItem(SIDEBAR_PINS_PENDING_STORAGE_KEY) ?? "[]"));
    return new Set(parsed.success ? parsed.data.flatMap((scope) => (scope ? [scope] : [])) : []);
  } catch {
    return new Set();
  }
}

export function writePendingSidebarPinScopes(
  scopes: ReadonlySet<string>,
  storage: SidebarPinStorage = window.localStorage,
): void {
  try {
    storage.setItem(SIDEBAR_PINS_PENDING_STORAGE_KEY, JSON.stringify([...scopes]));
  } catch {
    // The server keeps its last list. The next change from this computer sends the list again.
  }
}
