import { SKILL_CATEGORIES, type SkillCategory } from "@openbot/contracts/ipc-skills";
import { isDynamicRecord } from "@openbot/contracts/runtime-values";

export const MARKETPLACE_ROUTE = "/marketplace";
export const MARKETPLACE_SKILLS_ROUTE = "/marketplace/skills";
export const MARKETPLACE_APPS_ROUTE = "/marketplace/apps";

export type MarketplaceTab = "agents" | "skills" | "apps";

export const MARKETPLACE_TAB_ROUTES = {
  agents: MARKETPLACE_ROUTE,
  skills: MARKETPLACE_SKILLS_ROUTE,
  apps: MARKETPLACE_APPS_ROUTE,
} as const satisfies Record<MarketplaceTab, string>;

interface MarketplaceSearch {
  q?: string | undefined;
  category?: SkillCategory | undefined;
}

const MAX_QUERY_LENGTH = 100;

export function marketplaceSearch(value: unknown): MarketplaceSearch {
  if (!isDynamicRecord(value)) return {};
  const raw = value.q;
  const query = typeof raw === "string" || typeof raw === "number" ? String(raw).slice(0, MAX_QUERY_LENGTH) : "";
  const category = SKILL_CATEGORIES.find((item) => item === value.category);
  return { q: query.trim() === "" ? undefined : query, category };
}

export function marketplaceAppsSearch(value: unknown): Pick<MarketplaceSearch, "q"> {
  return { q: marketplaceSearch(value).q };
}

export function withMarketplaceQuery(query: string) {
  const q = query.trim() === "" ? undefined : query.slice(0, MAX_QUERY_LENGTH);
  return <Search extends MarketplaceSearch>(previous: Search): Search => ({ ...previous, q });
}

export function matchesMarketplaceQuery(query: string, ...fields: readonly string[]): boolean {
  const needle = query.trim().toLowerCase();
  return needle === "" || fields.some((field) => field.toLowerCase().includes(needle));
}
