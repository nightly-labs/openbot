import { createSignal } from "solid-js";

const PAGE_TABS_STORAGE_KEY = "openbot:side-panel-page-tabs";

function readPageTabsShown(): boolean {
  try {
    return window.localStorage.getItem(PAGE_TABS_STORAGE_KEY) === "true";
  } catch {
    return false;
  }
}

const [pageTabsShown, setPageTabsShown] = createSignal(readPageTabsShown());

export function showPageTabs(shown: boolean): void {
  setPageTabsShown(shown);
  try {
    window.localStorage.setItem(PAGE_TABS_STORAGE_KEY, String(shown));
  } catch {}
}

export { pageTabsShown };
