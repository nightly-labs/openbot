import {
  isSkillCategory,
  type MarketplaceAgentDetail,
  type MarketplaceAgentRoutine,
  type MarketplaceAgentSummary,
  type MarketplaceSkillSummary,
  type SkillCategory,
} from "@openbot/contracts/ipc";
import { isMarketplaceAgentId, isMarketplaceSkillSlug } from "@openbot/contracts/marketplace-links";
import { createServerFn } from "@tanstack/solid-start";
import { runApiEffect } from "../server/effect-runtime";

/** A routine as a listing page shows it. The instruction stays in the app, which shows it before Add. */
export type MarketplaceRoutineView = Omit<MarketplaceAgentRoutine, "instruction">;

export interface MarketplaceAgentView extends Omit<MarketplaceAgentDetail, "routines"> {
  routines: MarketplaceRoutineView[];
}

export interface MarketplaceAgentListing {
  agent: MarketplaceAgentView;
  /** The catalog entries of the agent's skills that are listed. A skill that is not gets no link. */
  skills: MarketplaceSkillSummary[];
}

export type MarketplaceSkillView = MarketplaceSkillSummary & { cardUrl: string | null };

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
  done: (items: readonly Item[]) => boolean = () => false,
): Promise<Item[]> {
  const items: Item[] = [];
  let cursor: string | undefined;
  for (let page = 0; page < MAX_PAGES; page += 1) {
    const result = await readPage(cursor);
    items.push(...result.items);
    if (result.nextCursor === null || done(items)) break;
    cursor = result.nextCursor;
  }
  return items;
}

/* D1 stores a skill's category as text that the Worker checked when it took the submission. A value
   this build does not know shows under Other, as no list leaves a skill out for it. */
function skillCategory(value: string): SkillCategory {
  return isSkillCategory(value) ? value : "other";
}

function isNotFoundError(error: unknown): boolean {
  return error instanceof Error && "status" in error && error.status === 404;
}

/*
 * The reads run on the Worker, because the pages need D1. Each import is inside its handler, so the
 * browser bundle never holds `cloudflare:workers` (see `agent-templates.ts`).
 */

async function readAgentCatalog(): Promise<MarketplaceAgentSummary[]> {
  const { requestAgentMarketplace } = await import("../server/request-auth");
  const marketplace = requestAgentMarketplace();
  return readCatalog(async (cursor) => {
    const page = await runApiEffect(marketplace.list({ cursor, limit: PAGE_LIMIT }));
    return { items: page.agents, nextCursor: page.nextCursor };
  });
}

async function readSkillCatalog(
  done?: (items: readonly MarketplaceSkillSummary[]) => boolean,
): Promise<MarketplaceSkillSummary[]> {
  const { requestSkillMarketplace } = await import("../server/request-auth");
  const marketplace = requestSkillMarketplace();
  return readCatalog(async (cursor) => {
    const page = await runApiEffect(marketplace.list({ cursor, limit: PAGE_LIMIT }));
    const items = page.skills.map((skill) => ({ ...skill, category: skillCategory(skill.category) }));
    return { items, nextCursor: page.nextCursor };
  }, done);
}

/** Every approved agent, featured first. A pending agent is in no list. */
export const readMarketplaceAgents = createServerFn({ method: "GET" }).handler(() => readAgentCatalog());

/** Every approved skill. */
export const readMarketplaceSkills = createServerFn({ method: "GET" }).handler(() => readSkillCatalog());

/**
 * One agent for its page: the approved version, or the version that waits for its first review when
 * there is none (`pending`). A rejected, removed or unknown agent, and a malformed id, are null.
 */
export const readMarketplaceAgentListing = createServerFn({ method: "GET" })
  .validator((id: unknown) => (typeof id === "string" ? id : ""))
  .handler(async ({ data }): Promise<MarketplaceAgentListing | null> => {
    if (!isMarketplaceAgentId(data)) return null;
    const { requestAgentMarketplace } = await import("../server/request-auth");
    let detail: MarketplaceAgentDetail;
    try {
      detail = await runApiEffect(requestAgentMarketplace().getListing(data));
    } catch (error) {
      if (isNotFoundError(error)) return null;
      throw error;
    }
    const agent: MarketplaceAgentView = {
      ...detail,
      routines: detail.routines.map(({ name, active, schedule }) => ({ name, active, schedule })),
    };
    const wanted = new Set(detail.skills.map((skill) => skill.skillId));
    if (wanted.size === 0) return { agent, skills: [] };
    const found = (items: readonly MarketplaceSkillSummary[]) => items.filter((skill) => wanted.has(skill.id));
    const catalog = await readSkillCatalog((items) => found(items).length >= wanted.size);
    return { agent, skills: found(catalog) };
  });

/** One approved skill for its page, without its instructions and files. Anything else is null. */
export const readMarketplaceSkill = createServerFn({ method: "GET" })
  .validator((slug: unknown) => (typeof slug === "string" ? slug : ""))
  .handler(async ({ data }): Promise<MarketplaceSkillView | null> => {
    if (!isMarketplaceSkillSlug(data)) return null;
    const { requestSkillMarketplace } = await import("../server/request-auth");
    try {
      const skill = await runApiEffect(requestSkillMarketplace().pageBySlug(data));
      return { ...skill, category: skillCategory(skill.category) };
    } catch (error) {
      if (isNotFoundError(error)) return null;
      throw error;
    }
  });

/** The approved agents and skills for the sitemap. A pending agent has no approved version, so it is never here. */
export async function readMarketplaceSitemapListings(): Promise<{
  agents: MarketplaceAgentSummary[];
  skills: MarketplaceSkillSummary[];
}> {
  const [agents, skills] = await Promise.all([readAgentCatalog(), readSkillCatalog()]);
  return { agents, skills };
}
