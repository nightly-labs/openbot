import type { BrowserTab, BrowserTabProfile } from "@openbot/contracts/ipc";
import { createEffect, createMemo, createSignal } from "solid-js";

/**
 * The browser profile of each open tab of one server, for the labels of the browser view. A tab
 * keeps its profile while it is open, so the list loads again only when the set of tabs or the
 * server changes. A rename shows on the next change. `read` is absent for a host without
 * `browser-profiles-v1`, which shows no labels.
 */
export function createBrowserTabProfiles(
  read: () => (() => Promise<BrowserTabProfile[]>) | undefined,
  tabs: () => readonly BrowserTab[],
) {
  const [profiles, setProfiles] = createSignal<ReadonlyMap<string, BrowserTabProfile>>(new Map());
  let request = 0;

  // A memo of the ids, so that a new title or address does not read the list again.
  const tabIds = createMemo(() =>
    tabs()
      .map((tab) => tab.id)
      .join("\n"),
  );

  createEffect(
    () => ({ load: read(), ids: tabIds() }),
    ({ load, ids }) => {
      const current = ++request;
      if (!load || ids === "") {
        setProfiles(new Map());
        return;
      }
      load().then(
        (entries) => {
          if (current === request) setProfiles(new Map(entries.map((entry) => [entry.tabId, entry])));
        },
        // A label is not necessary to use the tab, so a failed read keeps the last labels.
        () => undefined,
      );
    },
  );

  return (tab: BrowserTab): BrowserTabProfile | undefined => profiles().get(tab.id);
}
