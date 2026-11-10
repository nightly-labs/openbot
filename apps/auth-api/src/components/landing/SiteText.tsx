import type { JSX } from "@solidjs/web";
import { useMatches } from "@tanstack/solid-router";
import { createContext, type ParentProps, useContext } from "solid-js";
import { localizedPath } from "../../lib/site-paths";
import type { SiteChrome } from "../../lib/site-text";

const SiteTextContext = createContext<(() => SiteChrome | undefined) | null>(null, { name: "SiteText" });

/**
 * The site text of the deepest route whose loader returns `site`. The root route returns it in
 * English, and a page in another language returns its own, so the header and the footer have the
 * language of the page.
 */
export function useRouteSiteChrome(): () => SiteChrome | undefined {
  const matches = useMatches();
  return () => {
    for (const match of matches().toReversed()) {
      const data = match.loaderData;
      if (data && "site" in data) return data.site;
    }
    return undefined;
  };
}

/** Gives the header, the menu and the footer their text. `chrome` replaces the text of the routes. */
export function SiteTextProvider(props: ParentProps<{ chrome?: SiteChrome | undefined }>): JSX.Element {
  const routes = useRouteSiteChrome();
  return <SiteTextContext value={() => props.chrome ?? routes()}>{props.children}</SiteTextContext>;
}

/** The text of the header, the menu and the footer. Use it inside `SiteTextProvider`. */
export function useSiteChrome(): () => SiteChrome {
  const chrome = useContext(SiteTextContext);
  return () => {
    const value = chrome?.();
    if (!value) throw new Error("The site text is not loaded.");
    return value;
  };
}

/** The address of a page in the language of the page that links to it. See `localizedPath`. */
export function useSitePath() {
  const chrome = useSiteChrome();
  return <Path extends string>(path: Path) => localizedPath(path, chrome().locale);
}
