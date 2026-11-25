import { z } from "zod";

export type SidebarTabsByServer = Record<string, string[]>;

const SIDEBAR_TABS_STORAGE_KEY = "openbot:sidebar-tabs:v1";

type SidebarTabsStorage = Pick<Storage, "getItem" | "setItem">;

const tabsSchema = z.record(
  z.string().trim().min(1),
  z.array(z.string().trim().min(1).nullable().catch(null)).catch([]),
);

export function readSidebarTabs(storage: SidebarTabsStorage = window.localStorage): SidebarTabsByServer {
  try {
    const parsed = tabsSchema.safeParse(JSON.parse(storage.getItem(SIDEBAR_TABS_STORAGE_KEY) ?? "{}"));
    if (!parsed.success) return {};
    return Object.fromEntries(
      Object.entries(parsed.data).map(([serverId, values]) => [
        serverId,
        [...new Set(values.flatMap((value) => (value ? [value] : [])))],
      ]),
    );
  } catch {
    return {};
  }
}

export function writeSidebarTabs(
  tabsByServer: SidebarTabsByServer,
  storage: SidebarTabsStorage = window.localStorage,
): void {
  try {
    storage.setItem(SIDEBAR_TABS_STORAGE_KEY, JSON.stringify(tabsByServer));
  } catch {}
}
