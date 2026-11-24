import { isDynamicRecord } from "@openbot/contracts/runtime-values";

const COLLAPSED_KEY = "openbot:library-collapsed-rows";
const FAVORITES_KEY = "openbot:library-favorites";

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
    return {};
  }
}

function saveAll(storageKey: string, serverId: string, keys: readonly string[]): void {
  const rows = readAll(storageKey);
  if (keys.length === 0) delete rows[serverId];
  else rows[serverId] = keys.slice(-ROW_LIMIT);
  try {
    window.localStorage.setItem(storageKey, JSON.stringify(rows));
  } catch {}
}

export function readLibraryCollapsedRows(serverId: string): string[] {
  return readAll(COLLAPSED_KEY)[serverId] ?? [];
}

export function saveLibraryCollapsedRows(serverId: string, keys: readonly string[]): void {
  saveAll(COLLAPSED_KEY, serverId, keys);
}

export function readLibraryFavorites(serverId: string): string[] {
  return readAll(FAVORITES_KEY)[serverId] ?? [];
}

export function saveLibraryFavorites(serverId: string, keys: readonly string[]): void {
  saveAll(FAVORITES_KEY, serverId, keys);
}
