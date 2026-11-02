import { useEffect, useRef, useState } from "react";
import type { MobileBrowserTab } from "../model/browser-tabs";

const NONE: ReadonlySet<string> = new Set();

/**
 * The agent's tabs that opened behind the tab on screen, such as a link that the page opens in a new
 * tab. A tab stays unseen until the person shows it or it closes.
 *
 * `loaded` is false until the host's first tab list arrives: the tabs of that list are not new.
 * `opening` is true while the phone opens a tab of its own, which it shows next.
 */
export function useUnseenBrowserTabs(
  tabs: readonly MobileBrowserTab[],
  shownTabId: string | null,
  loaded: boolean,
  opening: boolean,
): ReadonlySet<string> {
  const known = useRef<ReadonlySet<string> | null>(null);
  const [unseen, setUnseen] = useState(NONE);
  useEffect(() => {
    if (!loaded) return;
    const ids = new Set(tabs.map((tab) => tab.id));
    const previous = known.current;
    known.current = ids;
    if (!previous) return;
    const added = opening ? [] : tabs.filter((tab) => !previous.has(tab.id)).map((tab) => tab.id);
    setUnseen((current) => {
      const next = new Set([...current, ...added].filter((id) => ids.has(id) && id !== shownTabId));
      return next.size === current.size && [...next].every((id) => current.has(id)) ? current : next;
    });
  }, [tabs, shownTabId, loaded, opening]);
  return unseen;
}
