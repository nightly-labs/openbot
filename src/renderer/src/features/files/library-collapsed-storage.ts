import { isDynamicRecord } from "@openbot/contracts/runtime-values";

const STORAGE_KEY = "openbot:library-collapsed-rows";

/** A server keeps at most this many rows, so the stored value stays small. */
const ROW_LIMIT = 500;

function readAll(): Record<string, string[]> {
  try {
    const parsed = JSON.parse(window.localStorage.getItem(STORAGE_KEY) ?? "{}");
    if (!isDynamicRecord(parsed)) return {};
    const rows: Record<string, string[]> = {};
    for (const [serverId, keys] of Object.entries(parsed)) {
      if (Array.isArray(keys)) rows[serverId] = keys.filter((key): key is string => typeof key === "string");
    }
    return rows;
  } catch {
    // Blocked storage or a damaged value: each row shows its folders.
    return {};
  }
}

/**
 * The rows of the Library side panel that hide their folders, for one server, on this device and
 * browser. The folders are on the host; which rows are open is a choice of the person who looks.
 */
export function readLibraryCollapsedRows(serverId: string): string[] {
  return readAll()[serverId] ?? [];
}

export function saveLibraryCollapsedRows(serverId: string, keys: readonly string[]): void {
  const rows = readAll();
  if (keys.length === 0) delete rows[serverId];
  else rows[serverId] = keys.slice(-ROW_LIMIT);
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(rows));
  } catch {
    // Blocked or full storage keeps the rows for this visit only.
  }
}
