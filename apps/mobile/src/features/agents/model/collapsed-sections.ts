import * as SecureStore from "expo-secure-store";
import { create } from "zustand";

/** The sections that the user collapsed, for each server. The desktop keeps the same choice per device. */
type CollapsedSections = Record<string, ReadonlySet<string>>;

const key = "openbot.mobile.collapsed-sections.v1";

export const useCollapsedSections = create<{ byServer: CollapsedSections; ready: boolean }>(() => ({
  byServer: {},
  ready: false,
}));

/** Reads the stored value. A missing or damaged value collapses no section. */
function decodeCollapsedSections(stored: string | null): CollapsedSections {
  let value: unknown = null;
  try {
    value = stored === null ? null : JSON.parse(stored);
  } catch {
    value = null;
  }
  if (typeof value !== "object" || value === null || Array.isArray(value)) return {};
  const byServer: CollapsedSections = {};
  for (const [serverId, ids] of Object.entries(value)) {
    if (!serverId || !Array.isArray(ids)) continue;
    const sectionIds = ids.filter((id): id is string => typeof id === "string" && id.length > 0);
    if (sectionIds.length > 0) byServer[serverId] = new Set(sectionIds);
  }
  return byServer;
}

export async function loadCollapsedSections(): Promise<void> {
  if (useCollapsedSections.getState().ready) return;
  try {
    const stored = await SecureStore.getItemAsync(key);
    if (!useCollapsedSections.getState().ready)
      useCollapsedSections.setState({ byServer: decodeCollapsedSections(stored) });
  } catch {
    // A display preference that does not load leaves every section open.
  } finally {
    useCollapsedSections.setState({ ready: true });
  }
}

// Writes run in order, so the last change is the one that stays stored.
let writes: Promise<void> = Promise.resolve();

/**
 * Collapses or expands one section. The change applies to the stored sections, so a tap before the
 * read ends does not replace them. The list changes at once, also when the write fails.
 */
export async function toggleCollapsedSection(serverId: string, sectionId: string): Promise<void> {
  await loadCollapsedSections();
  const { byServer } = useCollapsedSections.getState();
  const next = new Set(byServer[serverId]);
  if (next.has(sectionId)) next.delete(sectionId);
  else next.add(sectionId);
  const updated: CollapsedSections = { ...byServer, [serverId]: next };
  useCollapsedSections.setState({ byServer: updated });
  const stored = JSON.stringify(
    Object.fromEntries(Object.entries(updated).flatMap(([id, ids]) => (ids.size > 0 ? [[id, [...ids]]] : []))),
  );
  writes = writes.then(() => SecureStore.setItemAsync(key, stored)).catch(() => undefined);
}
