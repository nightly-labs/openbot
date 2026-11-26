import { createMemo, createSignal } from "solid-js";
import { SIDEBAR_NO_LIST_FILTER, type SidebarFolderNode, type SidebarListFilter } from "../sidebar-list-filter";
import {
  SIDEBAR_ALL_TAB_ID,
  SIDEBAR_DEFAULT_TAB_IDS,
  type SidebarTab,
  sidebarListFilterPartsBeyond,
  sidebarListFiltersMatch,
  sidebarTabsFor,
  sidebarToggleTabId,
} from "../sidebar-tabs";
import type { SidebarProps } from "../sidebar-types";

export function createSidebarTabStore(deps: {
  props: SidebarProps;
  filterFolders: () => SidebarFolderNode[];
  listFilter: () => SidebarListFilter;
  listFilterCount: (patch: Partial<SidebarListFilter>) => number;
  setListFilter: (filter: SidebarListFilter) => void;
}) {
  const { props } = deps;
  const tabsSupported = () => props.onTabIdsChange !== undefined;
  const chosenTabIds = () => props.tabIds ?? SIDEBAR_DEFAULT_TAB_IDS;
  const tabs = createMemo((): SidebarTab[] =>
    tabsSupported() ? sidebarTabsFor(chosenTabIds(), deps.filterFolders()) : [],
  );
  const [chosenTab, setChosenTab] = createSignal(SIDEBAR_ALL_TAB_ID);
  const activeTab = createMemo((): SidebarTab | undefined => {
    const filter = deps.listFilter();
    const list = tabs();
    return (
      list.find((tab) => tab.id === chosenTab() && sidebarListFiltersMatch(tab.filter, filter)) ??
      list.find((tab) => sidebarListFiltersMatch(tab.filter, filter)) ??
      list.find((tab) => tab.id === chosenTab()) ??
      list[0]
    );
  });

  function selectTab(id: string): void {
    const tab = tabs().find((candidate) => candidate.id === id);
    if (!tab) return;
    setChosenTab(id);
    deps.setListFilter(tab.filter);
  }

  function toggleTab(id: string): void {
    const next = sidebarToggleTabId(chosenTabIds(), id);
    props.onTabIdsChange?.(next);
    if (!next.includes(id) && activeTab()?.id === id) selectTab(SIDEBAR_ALL_TAB_ID);
  }

  const listFilterPartsBeyondTab = () =>
    sidebarListFilterPartsBeyond(deps.listFilter(), activeTab()?.filter ?? SIDEBAR_NO_LIST_FILTER);

  const tabUnreadCount = (tab: SidebarTab) =>
    tab.id === SIDEBAR_ALL_TAB_ID ? 0 : deps.listFilterCount({ ...tab.filter, unread: true, working: false });

  return {
    activeTab,
    chosenTabIds,
    listFilterPartsBeyondTab,
    selectTab,
    tabUnreadCount,
    tabs,
    tabsSupported,
    toggleTab,
  };
}
