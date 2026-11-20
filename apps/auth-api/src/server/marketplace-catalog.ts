import {
  isSkillCategory,
  type MarketplaceAgentSummary,
  type MarketplaceSkillSummary,
  type SkillCategory,
} from "@openbot/contracts/ipc";
import { runApiEffect } from "./effect-runtime";

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

export function skillCategory(value: string): SkillCategory {
  return isSkillCategory(value) ? value : "other";
}

export async function readAgentCatalog(): Promise<MarketplaceAgentSummary[]> {
  const { requestAgentMarketplace } = await import("./request-auth");
  const marketplace = requestAgentMarketplace();
  return readCatalog(async (cursor) => {
    const page = await runApiEffect(marketplace.list({ cursor, limit: PAGE_LIMIT }));
    return { items: page.agents, nextCursor: page.nextCursor };
  });
}

export async function readSkillCatalog(): Promise<MarketplaceSkillSummary[]> {
  const { requestSkillMarketplace } = await import("./request-auth");
  const marketplace = requestSkillMarketplace();
  return readCatalog(async (cursor) => {
    const page = await runApiEffect(marketplace.list({ cursor, limit: PAGE_LIMIT }));
    const items = page.skills.map((skill) => ({ ...skill, category: skillCategory(skill.category) }));
    return { items, nextCursor: page.nextCursor };
  });
}

export async function readMarketplaceSitemapListings(): Promise<{
  agents: MarketplaceAgentSummary[];
  skills: MarketplaceSkillSummary[];
}> {
  const [agents, skills] = await Promise.all([readAgentCatalog(), readSkillCatalog()]);
  return { agents, skills };
}
