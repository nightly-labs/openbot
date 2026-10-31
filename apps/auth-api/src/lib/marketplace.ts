import type { MarketplaceAgentDetail, MarketplaceAgentRoutine, MarketplaceSkillSummary } from "@openbot/contracts/ipc";
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

function isNotFoundError(error: unknown): boolean {
  return error instanceof Error && "status" in error && error.status === 404;
}

/*
 * The reads run on the Worker, because the pages need D1. Each import is inside its handler, so the
 * browser bundle never holds `cloudflare:workers` (see `agent-templates.ts`).
 */

const catalog = () => import("../server/marketplace-catalog");

/** Every approved agent, featured first. A pending agent is in no list. */
export const readMarketplaceAgents = createServerFn({ method: "GET" }).handler(async () =>
  (await catalog()).readAgentCatalog(),
);

/** Every approved skill. */
export const readMarketplaceSkills = createServerFn({ method: "GET" }).handler(async () =>
  (await catalog()).readSkillCatalog(),
);

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
    const { readSkillCatalog } = await catalog();
    const skills = await readSkillCatalog((items) => found(items).length >= wanted.size);
    return { agent, skills: found(skills) };
  });

/** One approved skill for its page, without its instructions and files. Anything else is null. */
export const readMarketplaceSkill = createServerFn({ method: "GET" })
  .validator((slug: unknown) => (typeof slug === "string" ? slug : ""))
  .handler(async ({ data }): Promise<MarketplaceSkillView | null> => {
    if (!isMarketplaceSkillSlug(data)) return null;
    const { requestSkillMarketplace } = await import("../server/request-auth");
    const { skillCategory } = await catalog();
    try {
      const skill = await runApiEffect(requestSkillMarketplace().pageBySlug(data));
      return { ...skill, category: skillCategory(skill.category) };
    } catch (error) {
      if (isNotFoundError(error)) return null;
      throw error;
    }
  });
