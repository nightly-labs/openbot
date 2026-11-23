import {
  type InstalledSkill,
  isRemovableSkill,
  type MarketplaceSkillSort,
  type MarketplaceSkillSummary,
  parseGithubSkillId,
} from "@openbot/contracts/ipc";
import { useText } from "@openbot/ui/text";
import type { MarketplaceAgent, MarketplaceModel } from "./marketplace-model";

export const isOn = (skill: InstalledSkill | undefined) => skill?.enabled !== false;

export function outdated(skill: InstalledSkill | undefined, version?: number): boolean {
  if (skill?.state === "update-available") return true;
  return skill?.state === "installed" && version !== undefined && skill.installedVersion < version;
}

export function canSwitch(skill: InstalledSkill): boolean {
  return skill.state !== "modified" && skill.state !== "needs-repair";
}

export function agentsWith(model: MarketplaceModel, skillId: string): MarketplaceAgent[] {
  return model.agents().filter((agent) => model.installedSkill(agent.id, skillId) !== undefined);
}

export function matches(query: string, text: string): boolean {
  const search = query.trim().toLowerCase();
  return search === "" || text.toLowerCase().includes(search);
}

export function userSkills(
  model: MarketplaceModel,
  catalog: readonly MarketplaceSkillSummary[],
): readonly InstalledSkill[] {
  const seen = new Map<string, InstalledSkill>();
  const add = (skill: InstalledSkill | undefined) => {
    if (skill && isRemovableSkill(skill) && !seen.has(skill.skillId)) seen.set(skill.skillId, skill);
  };
  for (const agent of model.agents()) {
    const installed = model.installedSkills?.(agent.id);
    if (installed) for (const skill of installed) add(skill);
    else for (const listing of catalog) add(model.installedSkill(agent.id, listing.id));
  }
  return [...seen.values()].sort((left, right) => left.name.localeCompare(right.name));
}

export interface SortKey {
  name: string;
  installs: number;
  updatedAt: string;
}

export function bySort(sort: MarketplaceSkillSort) {
  return (left: SortKey, right: SortKey) => {
    if (sort === "installs") return right.installs - left.installs || left.name.localeCompare(right.name);
    if (sort === "updated") return right.updatedAt.localeCompare(left.updatedAt) || left.name.localeCompare(right.name);
    return left.name.localeCompare(right.name);
  };
}

export function useSkillWords(model: () => MarketplaceModel) {
  const { t, format } = useText();

  const agentNames = (agents: readonly MarketplaceAgent[]): string => {
    if (agents.length <= 3) return format.list(agents.map((agent) => agent.name));
    if (agents.length === model().agents().length) return t("marketplace.skills.allAgents");
    return t("marketplace.skills.agentCount", { count: agents.length });
  };

  const plainState = (skill: InstalledSkill, version?: number): string | undefined => {
    const parts: string[] = [];
    if (!isOn(skill)) parts.push(t("marketplace.skills.state.off"));
    if (skill.state === "needs-repair") parts.push(t("marketplace.skills.state.repair"));
    else if (outdated(skill, version)) parts.push(t("marketplace.skills.state.update"));
    else if (skill.state === "modified") parts.push(t("marketplace.skills.state.modified"));
    return parts.length > 0 ? parts.join(" · ") : undefined;
  };

  const stateOn = (skillId: string, version?: number): string | undefined => {
    const have = model()
      .agents()
      .flatMap((agent) => {
        const skill = model().installedSkill(agent.id, skillId);
        return skill ? [{ agent, skill }] : [];
      });
    const [only] = have;
    if (have.length === 1 && only) return plainState(only.skill, version);
    const on = (test: (skill: InstalledSkill) => boolean) =>
      have.filter((one) => test(one.skill)).map((one) => one.agent);
    const parts = [
      { state: t("marketplace.skills.state.off"), agents: on((skill) => !isOn(skill)) },
      { state: t("marketplace.skills.state.repair"), agents: on((skill) => skill.state === "needs-repair") },
      { state: t("marketplace.skills.state.update"), agents: on((skill) => outdated(skill, version)) },
      { state: t("marketplace.skills.state.modified"), agents: on((skill) => skill.state === "modified") },
    ].filter((part) => part.agents.length > 0);
    if (parts.length === 0) return undefined;
    return parts
      .map((part) => t("marketplace.skills.stateOn", { state: part.state, agents: agentNames(part.agents) }))
      .join(" · ");
  };

  const sourceOf = (skill: InstalledSkill): string => {
    if (skill.origin === "local") return t("marketplace.skills.origin.local");
    if (skill.origin === "workspace") return t("marketplace.skills.origin.workspace");
    const github = parseGithubSkillId(skill.skillId);
    if (github) return t("marketplace.skills.origin.github", { repository: `${github.owner}/${github.repo}` });
    return t("marketplace.skills.origin.marketplace", { version: format.number(skill.installedVersion) });
  };

  const restingLine = (skill: InstalledSkill): string =>
    skill.origin === "local" ? sourceOf(skill) : (skill.description ?? sourceOf(skill));

  return { agentNames, plainState, stateOn, sourceOf, restingLine };
}
