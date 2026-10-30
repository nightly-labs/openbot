// What the header menu offers. Each section is one trigger and one panel, and
// the mobile sheet shows the same sections in the same order, so the two can not
// disagree about what the site holds.
//
// The collections come from `HEADER_COLLECTIONS`, the part of the one list of
// collections that the header offers. No JSX here, for the same reason
// `content-collection.ts` holds none.

import type { LandingIconName } from "../components/landing/LandingIcon";
import { BRAND_ROUTE } from "./brand-page";
import { CHANGELOG_ROUTE } from "./changelog";
import { HEADER_COLLECTIONS } from "./content";
import type { CollectionArticle, ContentCollection } from "./content-collection";
import { OPENBOT_LINKS } from "./landing-links";
import { PLUGIN_INDEX_ROUTE, SITE_PLUGINS, type SitePlugin } from "./plugins";
import { PRICING_ROUTE } from "./pricing-page";
import { TEAMS_ROUTE } from "./teams-page";

/** How many articles a panel lists: one featured, and the rest under it. */
const PANEL_ARTICLE_COUNT = 4;
/** Two columns of three. */
const PANEL_PLUGIN_COUNT = 6;

type HeaderCollectionId = (typeof HEADER_COLLECTIONS)[number]["id"];

export interface ArticleNavigationSection {
  kind: "articles";
  id: HeaderCollectionId;
  label: string;
  /** One line under the panel, next to the link to the index. */
  summary: string;
  indexLabel: string;
  /** Where the trigger itself goes: the panel is a preview of this page. */
  indexRoute: ContentCollection["indexRoute"];
  collection: ContentCollection;
  articles: readonly CollectionArticle[];
}

export interface PluginNavigationSection {
  kind: "plugins";
  id: "plugins";
  label: string;
  summary: string;
  indexLabel: string;
  indexRoute: typeof PLUGIN_INDEX_ROUTE;
  plugins: readonly SitePlugin[];
  pluginCount: number;
}

/** One row of the Resources panel: a page of this site, or a page somewhere else. */
export type ResourceLink = {
  label: string;
  description: string;
  /** "logo" draws the OpenBot mark. */
  icon: LandingIconName | "logo";
} & ({ to: typeof CHANGELOG_ROUTE | typeof BRAND_ROUTE | "/download" } | { href: string });

/** The pages that have no section of their own. It has no index page, so its trigger is a button. */
export interface ResourceNavigationSection {
  kind: "resources";
  id: "resources";
  label: string;
  summary: string;
  /** The footer link of the panel, on another site. */
  footer: { label: string; href: string };
  links: readonly ResourceLink[];
}

export type SiteNavigationSection = ArticleNavigationSection | PluginNavigationSection | ResourceNavigationSection;

const COLLECTION_COPY: Record<HeaderCollectionId, { summary: string; indexLabel: string }> = {
  news: { summary: "What shipped, and why it matters.", indexLabel: "All news" },
  guides: { summary: "Learn OpenBot one step at a time.", indexLabel: "All guides" },
  compare: { summary: "How OpenBot differs from other agent apps.", indexLabel: "All comparisons" },
};

export const SITE_NAVIGATION_SECTIONS: readonly SiteNavigationSection[] = [
  ...HEADER_COLLECTIONS.map(
    (collection): ArticleNavigationSection => ({
      kind: "articles",
      id: collection.id,
      label: collection.name,
      ...COLLECTION_COPY[collection.id],
      indexRoute: collection.indexRoute,
      collection,
      articles: collection.articles.slice(0, PANEL_ARTICLE_COUNT),
    }),
  ),
  {
    kind: "plugins",
    id: "plugins",
    label: "Plugins",
    summary: "Apps and skills an agent can use.",
    indexLabel: "Browse plugins",
    indexRoute: PLUGIN_INDEX_ROUTE,
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
    label: "Resources",
    summary: "The source code of OpenBot is open.",
    footer: { label: "Source code", href: OPENBOT_LINKS.repository },
    links: [
      { label: "Download", description: "macOS, Windows and Linux", icon: "download", to: "/download" },
      { label: "Changelog", description: "What changed in each version", icon: "refresh", to: CHANGELOG_ROUTE },
      { label: "Community", description: "Talk with us on Discord", icon: "contact", href: OPENBOT_LINKS.discord },
      {
        label: "Documentation",
        description: "Set up and use OpenBot",
        icon: "folder",
        href: OPENBOT_LINKS.documentation,
      },
      { label: "Brand", description: "The logo as SVG and PNG", icon: "logo", to: BRAND_ROUTE },
      { label: "Status", description: "Is the service up", icon: "cloud", href: OPENBOT_LINKS.status },
    ],
  },
];

/** A header entry with no panel: one page, reached in one press. */
export interface SiteNavigationLink {
  label: string;
  to: typeof TEAMS_ROUTE | typeof PRICING_ROUTE;
}

/** After the sections, in both the desktop menu and the mobile sheet. */
export const SITE_NAVIGATION_LINKS: readonly SiteNavigationLink[] = [
  { label: "For Teams", to: TEAMS_ROUTE },
  { label: "Pricing", to: PRICING_ROUTE },
];
