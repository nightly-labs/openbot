import { SKILL_CATEGORIES, type SkillCategory } from "@openbot/contracts/ipc-skills";
import { isDynamicRecord } from "@openbot/contracts/runtime-values";

/*
 * The public Marketplace on openbot.run. One address for each tab, category, search and listing:
 *
 *   /marketplace                    Agents
 *   /marketplace?category=coding    one category (also on Skills)
 *   /marketplace?q=release          a search (also on Skills and Apps)
 *   /marketplace/skills             Skills
 *   /marketplace/apps               Apps, the plugins that /plugins showed
 *   /marketplace/agents/<id>        one agent
 *   /marketplace/skills/<slug>      one skill
 *
 * The listing addresses are the ones `@openbot/contracts/marketplace-links` builds, so the link the app
 * copies and the page that opens are the same address.
 */

export const MARKETPLACE_ROUTE = "/marketplace";
export const MARKETPLACE_SKILLS_ROUTE = "/marketplace/skills";
export const MARKETPLACE_APPS_ROUTE = "/marketplace/apps";

export type MarketplaceTab = "agents" | "skills" | "apps";

export const MARKETPLACE_TAB_ROUTES = {
  agents: MARKETPLACE_ROUTE,
  skills: MARKETPLACE_SKILLS_ROUTE,
  apps: MARKETPLACE_APPS_ROUTE,
} as const satisfies Record<MarketplaceTab, string>;

/** The search of an index page. Both stay in the address, so a filtered list is a link that can be shared. */
interface MarketplaceSearch {
  q?: string | undefined;
  category?: SkillCategory | undefined;
}

const MAX_QUERY_LENGTH = 100;

export function marketplaceSearch(value: unknown): MarketplaceSearch {
  if (!isDynamicRecord(value)) return {};
  const raw = value.q;
  // The router parses `?q=42` as a number.
  const query = typeof raw === "string" || typeof raw === "number" ? String(raw).slice(0, MAX_QUERY_LENGTH) : "";
  const category = SKILL_CATEGORIES.find((item) => item === value.category);
  return { q: query.trim() === "" ? undefined : query, category };
}

/** The Apps tab has no categories: its tag switches filter it. */
export function marketplaceAppsSearch(value: unknown): Pick<MarketplaceSearch, "q"> {
  return { q: marketplaceSearch(value).q };
}

/** The search after the visitor typed `query`. The category stays; a blank search leaves the address. */
export function withMarketplaceQuery(query: string) {
  const q = query.trim() === "" ? undefined : query.slice(0, MAX_QUERY_LENGTH);
  return <Search extends MarketplaceSearch>(previous: Search): Search => ({ ...previous, q });
}

export function matchesMarketplaceQuery(query: string, ...fields: readonly string[]): boolean {
  const needle = query.trim().toLowerCase();
  return needle === "" || fields.some((field) => field.toLowerCase().includes(needle));
}
