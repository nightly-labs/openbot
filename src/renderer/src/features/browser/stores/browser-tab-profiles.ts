import type { BrowserTab, BrowserTabProfile } from "@openbot/contracts/ipc";
import { browserProfileProxyNames } from "@openbot/ui/features/browser/BrowserProxies";
import { currentText } from "@openbot/ui/text";
import { createEffect, createMemo, createSignal } from "solid-js";
import type { BrowserProfileCalls } from "../browser-profiles-port";

/** The profile of a tab, with the name of its proxy when the user can see the proxies of the server. */
type BrowserTabLabel = BrowserTabProfile & { proxy?: string | undefined };

/**
 * Reads the profile of each tab, with the name of its proxy. Only an admin can list the proxies; for
 * other members, and when a list fails, the labels show no proxy. Profile names are unique on a host.
 */
export function readTabProfilesWithProxies(calls: BrowserProfileCalls): () => Promise<BrowserTabLabel[]> {
  return async () => {
    const proxies = calls.proxies;
    const [entries, profiles, list] = await Promise.all([
      calls.tabProfiles(),
      proxies ? calls.list().catch(() => null) : null,
      proxies ? proxies.list().catch(() => null) : null,
    ]);
    if (!profiles || !list) return entries;
    const names = browserProfileProxyNames(list.proxies, list.computers, currentText().t);
    const byName = new Map(profiles.profiles.map((profile) => [profile.name, names.get(profile.id)]));
    return entries.map((entry) => (entry.name === null ? entry : { ...entry, proxy: byName.get(entry.name) }));
  };
}

/**
 * The browser profile of each open tab of one server, for the labels of the browser view. A tab
 * keeps its profile while it is open, so the list loads again only when the set of tabs or the
 * server changes. A rename shows on the next change. `read` is absent for a host without
 * `browser-profiles-v1`, which shows no labels.
 */
export function createBrowserTabProfiles(
  read: () => (() => Promise<BrowserTabLabel[]>) | undefined,
  tabs: () => readonly BrowserTab[],
) {
  const [profiles, setProfiles] = createSignal<ReadonlyMap<string, BrowserTabLabel>>(new Map());
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

  return (tab: BrowserTab): BrowserTabLabel | undefined => profiles().get(tab.id);
}
