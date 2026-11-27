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

const PANEL_ARTICLE_COUNT = 4;
const PANEL_PLUGIN_COUNT = 6;

type HeaderCollectionId = (typeof HEADER_COLLECTIONS)[number]["id"];

export interface ArticleNavigationSection {
  kind: "articles";
  id: HeaderCollectionId;
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

export type ResourceLink = {
  id: SiteResourceId;
  seed: string;
  icon: LandingIconName | "logo";
} & ({ to: typeof CHANGELOG_ROUTE | typeof BRAND_ROUTE | "/download" } | { href: string });

export interface ResourceNavigationSection {
  kind: "resources";
  id: "resources";
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

export interface SiteNavigationLink {
  id: SiteLinkId;
  to: typeof TEAMS_ROUTE | typeof PRICING_ROUTE;
}

export const SITE_NAVIGATION_LINKS: readonly SiteNavigationLink[] = [
  { id: "teams", to: TEAMS_ROUTE },
  { id: "pricing", to: PRICING_ROUTE },
];
