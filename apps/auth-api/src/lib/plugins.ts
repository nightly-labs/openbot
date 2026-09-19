// The public plugin pages, over the catalog the desktop app installs from.
//
// The listings come from `@openbot/contracts/plugin-catalog`, which is the same array the app's
// Plugins tab reads. That is the point of the page: an address a reader can open says exactly what
// the app would show them, and it cannot drift, because there is nothing here to drift from.
//
// This module holds no JSX, for the same reason `content-collection.ts` holds none: it is read by
// the sitemap, which runs outside the renderer.

import type { MarketplacePluginDetail } from "@openbot/contracts/ipc-plugin-catalog";
import { SKILL_CATEGORY_LABELS } from "@openbot/contracts/ipc-skills";
import { findMarketplacePlugin, MARKETPLACE_PLUGINS } from "@openbot/contracts/plugin-catalog";
import { OPENBOT_SITE_URL } from "./site-metadata";

/**
 * The routes, spelled out rather than built, so a route the generated tree does not hold is a type
 * error here instead of a link that answers 404.
 */
export const PLUGIN_INDEX_ROUTE = "/plugins";
export const PLUGIN_DETAIL_ROUTE = "/plugins/$slug";

export const PLUGINS_TITLE = "Plugins — OpenBot";
export const PLUGINS_DESCRIPTION =
  "Apps and skills an OpenBot agent can use. Open a plugin in the app, and decide there what it connects to.";

/** Newest listing first is not a thing here: the order is the order the catalog declares. */
export const SITE_PLUGINS: readonly MarketplacePluginDetail[] = MARKETPLACE_PLUGINS;

export function findPlugin(slug: string): MarketplacePluginDetail | null {
  return findMarketplacePlugin(slug);
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
 * Without it, picking `Design` and `Data & Analytics` would ask for a plugin that is both.
 */
export type PluginTagGroup = "category" | "install";

export interface PluginTag {
  group: PluginTagGroup;
  /** Shown on a card and on its filter, and the value a selection is held by. */
  label: string;
}

/**
 * The short facts a listing carries, each read off the catalog rather than written for the card:
 * what kind of plugin it is, and whether a reader has to bring an account to it.
 *
 * Sign-in is the one a reader most wants before opening a listing, because it is the difference
 * between an install that finishes on its own and one that waits for a browser. A server declares it
 * by carrying an `auth` step, so this reads the servers rather than a field a catalog could forget
 * to set. The counts are left off on purpose: every listing today ships one app and no skill, so a
 * tag saying so would tell a reader nothing and would grow stale the day that changes.
 */
export function pluginTags(plugin: MarketplacePluginDetail): PluginTag[] {
  const needsSignIn = plugin.apps.some((app) => (app.server.auth?.length ?? 0) > 0);
  return [
    { group: "category", label: SKILL_CATEGORY_LABELS[plugin.category] },
    { group: "install", label: needsSignIn ? "Sign-in" : "No sign-in" },
  ];
}

/**
 * Every tag the given listings carry, each once, in the order the catalog puts them in. The filters
 * are built from the listings rather than from a list of their own, so a filter can never offer a
 * tag that no plugin has, and a new listing brings its filter with it.
 */
export function pluginTagFilters(plugins: readonly MarketplacePluginDetail[]): PluginTag[] {
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
export function matchesPluginTags(plugin: MarketplacePluginDetail, selected: readonly string[]): boolean {
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
