import {
  isSkillCategory,
  type MarketplaceAgentSummary,
  type MarketplaceSkillSummary,
  type SkillCategory,
} from "@openbot/contracts/ipc";
import { runApiEffect } from "./effect-runtime";

/*
 * The catalog reads of the public Marketplace pages and the sitemap. This module imports no router
 * code, so the Worker handler can load it for the sitemap. `request-auth` loads inside each read, as
 * it needs `cloudflare:workers`, which a script that imports the Worker handler does not have.
 */

/* The Worker pages the catalog at most 50 at a time. Ten pages hold every listing the Marketplace has
   today; a catalog that outgrows them needs search on the Worker, not more pages here. */
const PAGE_LIMIT = 50;
const MAX_PAGES = 10;

interface CatalogPage<Item> {
  items: Item[];
  nextCursor: string | null;
}

async function readCatalog<Item>(
  readPage: (cursor: string | undefined) => Promise<CatalogPage<Item>>,
): Promise<Item[]> {
  const items: Item[] = [];
  let cursor: string | undefined;
  for (let page = 0; page < MAX_PAGES; page += 1) {
    const result = await readPage(cursor);
    items.push(...result.items);
    if (result.nextCursor === null) break;
    cursor = result.nextCursor;
  }
  return items;
}

/* D1 stores a skill's category as text that the Worker checked when it took the submission. A value
   this build does not know shows under Other, as no list leaves a skill out for it. */
export function skillCategory(value: string): SkillCategory {
  return isSkillCategory(value) ? value : "other";
}

/** Every approved agent, featured first. A pending agent is in no list. */
export async function readAgentCatalog(): Promise<MarketplaceAgentSummary[]> {
  const { requestAgentMarketplace } = await import("./request-auth");
  const marketplace = requestAgentMarketplace();
  return readCatalog(async (cursor) => {
    const page = await runApiEffect(marketplace.list({ cursor, limit: PAGE_LIMIT }));
    return { items: page.agents, nextCursor: page.nextCursor };
  });
}

/** Every approved skill. */
export async function readSkillCatalog(): Promise<MarketplaceSkillSummary[]> {
  const { requestSkillMarketplace } = await import("./request-auth");
  const marketplace = requestSkillMarketplace();
  return readCatalog(async (cursor) => {
    const page = await runApiEffect(marketplace.list({ cursor, limit: PAGE_LIMIT }));
    const items = page.skills.map((skill) => ({ ...skill, category: skillCategory(skill.category) }));
    return { items, nextCursor: page.nextCursor };
  });
}

/** The approved agents and skills for the sitemap. A pending agent has no approved version, so it is never here. */
export async function readMarketplaceSitemapListings(): Promise<{
  agents: MarketplaceAgentSummary[];
  skills: MarketplaceSkillSummary[];
}> {
  const [agents, skills] = await Promise.all([readAgentCatalog(), readSkillCatalog()]);
  return { agents, skills };
}
