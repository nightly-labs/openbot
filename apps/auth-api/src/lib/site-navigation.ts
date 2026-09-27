// What the header menu offers. Each section is one trigger and one panel, and
// the mobile sheet shows the same sections in the same order, so the two can not
// disagree about what the site holds.
//
// The collections come from the one list of collections, so a section that is
// added reaches the header without it being edited. No JSX here, for the same
// reason `content-collection.ts` holds none.

import { CONTENT_COLLECTIONS } from "./content";
import type { CollectionArticle, ContentCollection } from "./content-collection";
import { PLUGIN_INDEX_ROUTE, SITE_PLUGINS, type SitePlugin } from "./plugins";

/** How many articles a panel lists: one featured, and the rest under it. */
const PANEL_ARTICLE_COUNT = 4;
/** Two columns of three. */
const PANEL_PLUGIN_COUNT = 6;

export interface ArticleNavigationSection {
  kind: "articles";
  id: ContentCollection["id"];
  label: string;
  /** One line under the panel, next to the link to the index. */
  summary: string;
  indexLabel: string;
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

export type SiteNavigationSection = ArticleNavigationSection | PluginNavigationSection;

const COLLECTION_COPY: Record<ContentCollection["id"], { summary: string; indexLabel: string }> = {
  news: { summary: "What shipped, and why it matters.", indexLabel: "All news" },
  guides: { summary: "Learn OpenBot one step at a time.", indexLabel: "All guides" },
};

export const SITE_NAVIGATION_SECTIONS: readonly SiteNavigationSection[] = [
  ...CONTENT_COLLECTIONS.map(
    (collection): ArticleNavigationSection => ({
      kind: "articles",
      id: collection.id,
      label: collection.name,
      ...COLLECTION_COPY[collection.id],
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
];
