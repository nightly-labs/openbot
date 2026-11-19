import { isDynamicRecord } from "@openbot/contracts/runtime-values";

/** The rows of the side panel that hide their folders. */
const COLLAPSED_KEY = "openbot:library-collapsed-rows";
/** The folders and the agents in the Favorites of the side panel, in the sequence that the user added them. */
const FAVORITES_KEY = "openbot:library-favorites";

/** A server keeps at most this many rows in each list, so the stored value stays small. */
const ROW_LIMIT = 500;

function readAll(storageKey: string): Record<string, string[]> {
  try {
    const parsed = JSON.parse(window.localStorage.getItem(storageKey) ?? "{}");
    if (!isDynamicRecord(parsed)) return {};
    const rows: Record<string, string[]> = {};
    for (const [serverId, keys] of Object.entries(parsed)) {
      if (Array.isArray(keys)) rows[serverId] = keys.filter((key): key is string => typeof key === "string");
    }
    return rows;
  } catch {
    // Blocked storage or a damaged value: the list is empty.
    return {};
  }
}

function saveAll(storageKey: string, serverId: string, keys: readonly string[]): void {
  const rows = readAll(storageKey);
  if (keys.length === 0) delete rows[serverId];
  else rows[serverId] = keys.slice(-ROW_LIMIT);
  try {
    window.localStorage.setItem(storageKey, JSON.stringify(rows));
  } catch {
    // Blocked or full storage keeps the list for this visit only.
  }
}

/**
 * The rows of the Library side panel that hide their folders, for one server, on this device and
 * browser. The folders are on the host; which rows are open is a choice of the person who looks.
 */
export function readLibraryCollapsedRows(serverId: string): string[] {
  return readAll(COLLAPSED_KEY)[serverId] ?? [];
}

export function saveLibraryCollapsedRows(serverId: string, keys: readonly string[]): void {
  saveAll(COLLAPSED_KEY, serverId, keys);
}

/**
 * The Favorites of the Library side panel for one server, on this device and browser: folder ids and
 * agent keys. Each member of a server has their own.
 */
export function readLibraryFavorites(serverId: string): string[] {
  return readAll(FAVORITES_KEY)[serverId] ?? [];
}

export function saveLibraryFavorites(serverId: string, keys: readonly string[]): void {
  saveAll(FAVORITES_KEY, serverId, keys);
}
