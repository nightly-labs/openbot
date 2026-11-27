import type { JSX } from "@solidjs/web";
import { useMatches } from "@tanstack/solid-router";
import { createContext, type ParentProps, useContext } from "solid-js";
import { localizedPath } from "../../lib/site-paths";
import type { SiteChrome } from "../../lib/site-text";

const SiteTextContext = createContext<(() => SiteChrome | undefined) | null>(null, { name: "SiteText" });

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

export function SiteTextProvider(props: ParentProps<{ chrome?: SiteChrome | undefined }>): JSX.Element {
  const routes = useRouteSiteChrome();
  return <SiteTextContext value={() => props.chrome ?? routes()}>{props.children}</SiteTextContext>;
}

export function useSiteChrome(): () => SiteChrome {
  const chrome = useContext(SiteTextContext);
  return () => {
    const value = chrome?.();
    if (!value) throw new Error("The site text is not loaded.");
    return value;
  };
}

export function useSitePath() {
  const chrome = useSiteChrome();
  return <Path extends string>(path: Path) => localizedPath(path, chrome().locale);
}
