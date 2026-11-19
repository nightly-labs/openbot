import type { BrowserTab, BrowserTabProfile } from "@openbot/contracts/ipc";
import { browserProfileProxyNames } from "@openbot/ui/features/browser/BrowserProxies";
import { currentText } from "@openbot/ui/text";
import { createEffect, createMemo, createSignal } from "solid-js";
import type { BrowserProfileCalls } from "../browser-profiles-port";

type BrowserTabLabel = BrowserTabProfile & { proxy?: string | undefined };

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

export function createBrowserTabProfiles(
  read: () => (() => Promise<BrowserTabLabel[]>) | undefined,
  tabs: () => readonly BrowserTab[],
) {
  const [profiles, setProfiles] = createSignal<ReadonlyMap<string, BrowserTabLabel>>(new Map());
  let request = 0;

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
        () => undefined,
      );
    },
  );

  return (tab: BrowserTab): BrowserTabLabel | undefined => profiles().get(tab.id);
}
