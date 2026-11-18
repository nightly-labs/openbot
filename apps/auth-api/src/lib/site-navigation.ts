// What the header menu offers. Each section is one trigger and one panel, and
// the mobile sheet shows the same sections in the same order, so the two can not
// disagree about what the site holds.
//
// The collections come from `HEADER_COLLECTIONS`, the part of the one list of
// collections that the header offers. No JSX here, for the same reason
// `content-collection.ts` holds none. The text is in `SiteText`, under the id of
// each section and link, so the header has the language of the page.

import type { LandingIconName } from "../components/landing/LandingIcon";
import { BRAND_ROUTE } from "./brand-page";
import { CHANGELOG_ROUTE } from "./changelog";
import { HEADER_COLLECTIONS } from "./content";
import type { CollectionArticle, ContentCollection } from "./content-collection";
import { OPENBOT_LINKS } from "./landing-links";
import { MARKETPLACE_APPS_ROUTE } from "./marketplace-routes";
import { SITE_PLUGINS, type SitePlugin } from "./plugins";
import { PRICING_ROUTE } from "./pricing-page";
import type { SiteLinkId, SiteResourceId } from "./site-text";
import { TEAMS_ROUTE } from "./teams-page";

/** How many articles a panel lists: one featured, and the rest under it. */
const PANEL_ARTICLE_COUNT = 4;
/** Two columns of three. */
const PANEL_PLUGIN_COUNT = 6;

type HeaderCollectionId = (typeof HEADER_COLLECTIONS)[number]["id"];

export interface ArticleNavigationSection {
  kind: "articles";
  id: HeaderCollectionId;
  /** Where the trigger itself goes: the panel is a preview of this page. */
  indexRoute: ContentCollection["indexRoute"];
  collection: ContentCollection;
  articles: readonly CollectionArticle[];
}

export interface PluginNavigationSection {
  kind: "plugins";
  id: "plugins";
  indexRoute: typeof MARKETPLACE_APPS_ROUTE;
  plugins: readonly SitePlugin[];
  pluginCount: number;
}

/** One row of the Resources panel: a page of this site, or a page somewhere else. */
export type ResourceLink = {
  id: SiteResourceId;
  /** The seed of the gradient behind the icon. It is the English label, so each row keeps its colours. */
  seed: string;
  /** "logo" draws the OpenBot mark. */
  icon: LandingIconName | "logo";
} & ({ to: typeof CHANGELOG_ROUTE | typeof BRAND_ROUTE | "/download" } | { href: string });

/** The pages that have no section of their own. It has no index page, so its trigger is a button. */
export interface ResourceNavigationSection {
  kind: "resources";
  id: "resources";
  /** The footer link of the panel, on another site. */
  footer: { href: string };
  links: readonly ResourceLink[];
}

export type SiteNavigationSection = ArticleNavigationSection | PluginNavigationSection | ResourceNavigationSection;

export const SITE_NAVIGATION_SECTIONS: readonly SiteNavigationSection[] = [
  ...HEADER_COLLECTIONS.map(
    (collection): ArticleNavigationSection => ({
      kind: "articles",
      id: collection.id,
      indexRoute: collection.indexRoute,
      collection,
      articles: collection.articles.slice(0, PANEL_ARTICLE_COUNT),
    }),
  ),
  {
    kind: "plugins",
    id: "plugins",
    indexRoute: MARKETPLACE_APPS_ROUTE,
    // Featured first, and otherwise in the order the catalog declares.
    plugins: SITE_PLUGINS.toSorted((left, right) => Number(right.featured) - Number(left.featured)).slice(
      0,
      PANEL_PLUGIN_COUNT,
    ),
    pluginCount: SITE_PLUGINS.length,
  },
  {
    kind: "resources",
    id: "resources",
    footer: { href: OPENBOT_LINKS.repository },
    links: [
      { id: "download", seed: "Download", icon: "download", to: "/download" },
      { id: "changelog", seed: "Changelog", icon: "refresh", to: CHANGELOG_ROUTE },
      { id: "community", seed: "Community", icon: "contact", href: OPENBOT_LINKS.discord },
      { id: "documentation", seed: "Documentation", icon: "folder", href: OPENBOT_LINKS.documentation },
      { id: "brand", seed: "Brand", icon: "logo", to: BRAND_ROUTE },
      { id: "status", seed: "Status", icon: "cloud", href: OPENBOT_LINKS.status },
    ],
  },
];

/** A header entry with no panel: one page, reached in one press. */
export interface SiteNavigationLink {
  id: SiteLinkId;
  to: typeof TEAMS_ROUTE | typeof PRICING_ROUTE;
}

/** After the sections, in both the desktop menu and the mobile sheet. */
export const SITE_NAVIGATION_LINKS: readonly SiteNavigationLink[] = [
  { id: "teams", to: TEAMS_ROUTE },
  { id: "pricing", to: PRICING_ROUTE },
];
