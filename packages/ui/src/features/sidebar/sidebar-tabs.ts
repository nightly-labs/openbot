import {
  SIDEBAR_NO_LIST_FILTER,
  type SidebarFolderNode,
  type SidebarListFilter,
  sidebarFolderTreeIds,
} from "./sidebar-list-filter";

export const SIDEBAR_ALL_TAB_ID = "all";
export const SIDEBAR_UNREAD_TAB_ID = "unread";
export const SIDEBAR_DEFAULT_TAB_IDS: readonly string[] = [SIDEBAR_UNREAD_TAB_ID];

const FOLDER_TAB_PREFIX = "folder:";

export interface SidebarTab {
  id: string;
  folder: SidebarFolderNode | null;
  filter: SidebarListFilter;
}

export function sidebarFolderTabId(folderId: string): string {
  return `${FOLDER_TAB_PREFIX}${folderId}`;
}

export function sidebarTabsFor(chosenIds: readonly string[], folders: readonly SidebarFolderNode[]): SidebarTab[] {
  const chosen = new Set(chosenIds);
  const tabs: SidebarTab[] = [{ id: SIDEBAR_ALL_TAB_ID, folder: null, filter: SIDEBAR_NO_LIST_FILTER }];
  if (chosen.has(SIDEBAR_UNREAD_TAB_ID)) {
    tabs.push({ id: SIDEBAR_UNREAD_TAB_ID, folder: null, filter: { ...SIDEBAR_NO_LIST_FILTER, unread: true } });
  }
  for (const folder of folders) {
    const id = sidebarFolderTabId(folder.id);
    if (chosen.has(id)) {
      tabs.push({ id, folder, filter: { ...SIDEBAR_NO_LIST_FILTER, folders: sidebarFolderTreeIds(folder) } });
    }
  }
  return tabs;
}

function sidebarFoldersMatch(first: readonly string[], second: readonly string[]): boolean {
  return first.length === second.length && first.every((id) => second.includes(id));
}

export function sidebarListFiltersMatch(first: SidebarListFilter, second: SidebarListFilter): boolean {
  return sidebarListFilterPartsBeyond(first, second) === 0;
}

export function sidebarListFilterPartsBeyond(filter: SidebarListFilter, base: SidebarListFilter): number {
  return (
    Number(filter.show !== base.show) +
    Number(filter.unread !== base.unread || filter.working !== base.working) +
    Number(!sidebarFoldersMatch(filter.folders, base.folders))
  );
}

export function sidebarToggleTabId(chosenIds: readonly string[], id: string): string[] {
  return chosenIds.includes(id) ? chosenIds.filter((candidate) => candidate !== id) : [...chosenIds, id];
}
