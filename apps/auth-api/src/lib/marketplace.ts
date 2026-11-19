import type { MarketplaceAgentDetail, MarketplaceAgentRoutine, MarketplaceSkillSummary } from "@openbot/contracts/ipc";
import { isMarketplaceAgentId, isMarketplaceSkillSlug } from "@openbot/contracts/marketplace-links";
import { createServerFn } from "@tanstack/solid-start";
import { runApiEffect } from "../server/effect-runtime";

export type MarketplaceRoutineView = Omit<MarketplaceAgentRoutine, "instruction">;

export interface MarketplaceAgentView extends Omit<MarketplaceAgentDetail, "routines"> {
  routines: MarketplaceRoutineView[];
}

export interface MarketplaceAgentListing {
  agent: MarketplaceAgentView;
  skills: MarketplaceSkillSummary[];
}

export type MarketplaceSkillView = MarketplaceSkillSummary & { cardUrl: string | null };

function isNotFoundError(error: unknown): boolean {
  return error instanceof Error && "status" in error && error.status === 404;
}

const catalog = () => import("../server/marketplace-catalog");

export const readMarketplaceAgents = createServerFn({ method: "GET" }).handler(async () =>
  (await catalog()).readAgentCatalog(),
);

export const readMarketplaceSkills = createServerFn({ method: "GET" }).handler(async () =>
  (await catalog()).readSkillCatalog(),
);

export const readMarketplaceAgentListing = createServerFn({ method: "GET" })
  .validator((id: unknown) => (typeof id === "string" ? id : ""))
  .handler(async ({ data }): Promise<MarketplaceAgentListing | null> => {
    if (!isMarketplaceAgentId(data)) return null;
    const { requestAgentMarketplace, requestSkillMarketplace } = await import("../server/request-auth");
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
    const ids = [...new Set(detail.skills.map((skill) => skill.skillId))];
    const { skillCategory } = await catalog();
    const skills = await runApiEffect(requestSkillMarketplace().summariesByIds(ids));
    return { agent, skills: skills.map((skill) => ({ ...skill, category: skillCategory(skill.category) })) };
  });

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
