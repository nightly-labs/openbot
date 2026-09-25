// The public plugin pages, over the catalog the desktop app installs from.
//
// The listings are `./plugin-catalog.generated`, which `scripts/build-plugin-catalog.ts` writes
// from `marketplace/plugin-catalog/` - the same source the app's Plugins tab is built from. That is
// the point of the page: an address a reader can open says exactly what the app would show them,
// and it cannot drift, because both sides are generated from one folder.
//
// This module holds no JSX, for the same reason `content-collection.ts` holds none: it is read by
// the sitemap, which runs outside the renderer.

import { SKILL_CATEGORY_LABELS } from "@openbot/contracts/ipc-skills";
import { createPluginShareUrl } from "@openbot/contracts/plugin-links";
import { PLUGIN_CATALOG_DETAILS, PLUGIN_CATALOG_INDEX, type PluginCatalogDetail } from "./plugin-catalog.generated";
import { OPENBOT_SITE_URL } from "./site-metadata";

/**
 * One listing as the pages read it: what the generator writes, and the two facts the index carries
 * rather than the detail - whether the catalog leads with it, and the address that opens it here.
 */
export interface SitePlugin extends PluginCatalogDetail {
  featured: boolean;
  /** The listing address "Copy link" writes out, not the developer's own site. */
  shareUrl: string;
}

/** One skill of a listing, once it is known to be shaped like one. */
export interface SitePluginSkill {
  slug: string;
  description: string;
}

/**
 * The routes, spelled out rather than built, so a route the generated tree does not hold is a type
 * error here instead of a link that answers 404.
 */
export const PLUGIN_INDEX_ROUTE = "/plugins";
export const PLUGIN_DETAIL_ROUTE = "/plugins/$slug";

export const PLUGINS_TITLE = "Plugins — OpenBot";
export const PLUGINS_DESCRIPTION =
  "Apps and skills an OpenBot agent can use. Open a plugin in the app, and decide there what it connects to.";

/** Newest listing first is not a thing here: the order is the order the index declares. */
export const SITE_PLUGINS: readonly SitePlugin[] = PLUGIN_CATALOG_INDEX.plugins.flatMap((entry) => {
  const detail = PLUGIN_CATALOG_DETAILS[entry.slug];
  return detail ? [{ ...detail, featured: entry.featured, shareUrl: createPluginShareUrl(entry.slug) }] : [];
});

/**
 * When the catalog last changed, as the catalog itself states it. Every listing shares the date,
 * because the catalog is written and published as one document; the sitemap dates its plugin pages
 * by it rather than by a per-listing date no source holds.
 */
export const PLUGINS_UPDATED_AT = PLUGIN_CATALOG_INDEX.updatedAt;

export function findPlugin(slug: string): SitePlugin | null {
  return SITE_PLUGINS.find((plugin) => plugin.slug === slug) ?? null;
}

/**
 * What the app's own listing calls this kind of plugin. The generated catalog states the category
 * as a string, because it is written by hand in `marketplace/plugin-catalog/`; a word the app has
 * no label for is shown as it was written rather than as `undefined`.
 */
export function pluginCategoryLabel(category: string): string {
  const labels: Record<string, string> = SKILL_CATEGORY_LABELS;
  return labels[category] ?? category;
}

/**
 * The skills a listing installs beside its app. The generated detail holds them as unknown, so each
 * one is read here rather than trusted: a listing whose skills arrive in a shape this page does not
 * know loses the section instead of the page losing its meaning.
 */
export function pluginSkills(plugin: SitePlugin): SitePluginSkill[] {
  return plugin.skills.flatMap((skill) =>
    typeof skill === "object" &&
    skill !== null &&
    "slug" in skill &&
    typeof skill.slug === "string" &&
    "description" in skill &&
    typeof skill.description === "string"
      ? [{ slug: skill.slug, description: skill.description }]
      : [],
  );
}

export function pluginPath(slug: string): string {
  return `${PLUGIN_INDEX_ROUTE}/${slug}`;
}

/**
 * Where a listing's own icon is asked for: this origin, never the developer's. The Worker route
 * behind it reads the address from the catalog, so a reader of a plugin page connects to openbot.run
 * and to nothing else. `app` names one of the listing's apps, which can carry its own icon.
 */
export function pluginIconPath(slug: string, appId?: string): string {
  const path = `${PLUGIN_INDEX_ROUTE}/icon/${encodeURIComponent(slug)}`;
  return appId ? `${path}?app=${encodeURIComponent(appId)}` : path;
}

export function pluginUrl(slug: string, siteUrl: string = OPENBOT_SITE_URL): string {
  return new URL(pluginPath(slug), siteUrl).toString();
}

export function pluginIndexUrl(siteUrl: string = OPENBOT_SITE_URL): string {
  return new URL(PLUGIN_INDEX_ROUTE, siteUrl).toString();
}

/**
 * What a link row shows: the address without the scheme and without the `www.` a reader does not
 * need. The path stays, because a listing's three links usually differ only there. The same rule
 * the app's listing page uses, so the two read alike.
 */
export function pluginLinkText(url: string): string {
  try {
    const { host, pathname } = new URL(url);
    return `${host.replace(/^www\./, "")}${pathname === "/" ? "" : pathname.replace(/\/$/, "")}`;
  } catch {
    return url;
  }
}

/**
 * The address a listing's link row is allowed to open, or `null` for one it is not.
 *
 * The catalog is a literal in this repository today, but `docs/plugin-distribution.md` says it
 * becomes a document fetched from openbot.run. A link row is the one place a listing's own strings
 * reach an `href`, so the scheme is checked here rather than trusted: `javascript:`, `data:` and
 * anything else that is not a web address never reaches the page, and a listing that carries one
 * loses that row instead of the page losing its meaning. `new URL` also rejects the whitespace and
 * control characters a scheme can otherwise be smuggled past a string test with.
 */
export function pluginExternalHref(url: string | null): string | null {
  if (!url) return null;
  try {
    const parsed = new URL(url);
    return parsed.protocol === "https:" || parsed.protocol === "http:" ? parsed.toString() : null;
  } catch {
    return null;
  }
}

/**
 * Which question a tag answers. The group is what makes a set of them filter the way a reader
 * expects: two tags from one group widen a result, and two tags from different groups narrow it.
 * Without it, picking `Design` and `Data & Analytics` would ask for a plugin that is both. One
 * group is the whole list today, and the type says so rather than keeping a name nothing carries.
 */
type PluginTagGroup = "category";

export interface PluginTag {
  group: PluginTagGroup;
  /** Shown on a card and on its filter, and the value a selection is held by. */
  label: string;
}

/**
 * The one short fact a listing carries, read off the catalog rather than written for the card: what
 * kind of plugin it is.
 *
 * Nothing else earns a pill. The counts do not: every listing today ships one app and no skill, so a
 * tag saying so would tell a reader nothing. Whether the plugin asks for a sign-in does not either:
 * the app states that at the moment it matters, which is the install itself, and a pill here only
 * made two listings look different before a reader had any use for the difference.
 */
export function pluginTags(plugin: SitePlugin): PluginTag[] {
  return [{ group: "category", label: pluginCategoryLabel(plugin.category) }];
}

/**
 * Every tag the given listings carry, each once, in the order the catalog puts them in. The filters
 * are built from the listings rather than from a list of their own, so a filter can never offer a
 * tag that no plugin has, and a new listing brings its filter with it.
 */
export function pluginTagFilters(plugins: readonly SitePlugin[]): PluginTag[] {
  const seen = new Map<string, PluginTag>();
  for (const plugin of plugins) {
    for (const tag of pluginTags(plugin)) {
      if (!seen.has(tag.label)) seen.set(tag.label, tag);
    }
  }
  return [...seen.values()];
}

/**
 * Whether a listing survives a selection. Nothing selected keeps every listing; otherwise a listing
 * has to answer each group that was asked about, with any one of that group's chosen tags.
 */
export function matchesPluginTags(plugin: SitePlugin, selected: readonly string[]): boolean {
  if (selected.length === 0) return true;

  const carried = new Set(pluginTags(plugin).map((tag) => tag.label));
  const asked = new Map<PluginTagGroup, string[]>();
  for (const tag of pluginTagFilters(SITE_PLUGINS)) {
    if (selected.includes(tag.label)) asked.set(tag.group, [...(asked.get(tag.group) ?? []), tag.label]);
  }

  return [...asked.values()].every((group) => group.some((label) => carried.has(label)));
}

/**
 * The letter a listing falls back to, when `PluginLogo` holds no mark for its slug.
 *
 * Whatever a listing shows, the site never renders the catalog's `iconUrl`: it points at the
 * developer's own servers, and drawing it here would make every visitor's browser call a third
 * party that PRIVACY.md does not describe. The marks the site does draw are its own bytes, served
 * from openbot.run like the rest of the page. The app is a different case and shows the real icon.
 */
export function pluginMonogram(name: string): string {
  return [...name.trim()][0]?.toUpperCase() ?? "?";
}
