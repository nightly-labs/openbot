import type {
  InstalledSkill,
  MarketplaceSkillDetail,
  OpenBotDesktopApi,
  SkillSubmission,
} from "@openbot/contracts/ipc";
import {
  STORY_INSTALLED_SKILLS,
  STORY_MARKETPLACE_SKILL_DETAILS,
  STORY_MARKETPLACE_SKILLS,
  STORY_SKILL_PACKAGE_PREVIEW,
  STORY_SKILL_SUBMISSIONS,
} from "./fixtures";
import { clone, matchesQuery } from "./mock-support";

export interface MockSkillsOptions {
  localSkills?: MarketplaceSkillDetail[];
  installedSkills?: Record<string, InstalledSkill[]>;
}

function storyReleaseNotesSkill(): MarketplaceSkillDetail {
  const skill = STORY_MARKETPLACE_SKILL_DETAILS["skill-release-notes"];
  if (!skill) throw new Error("The release notes skill fixture is missing.");
  return skill;
}
/** The skills marketplace, local skills, and the skills installed on each agent. */
export function createMockSkills(options: MockSkillsOptions) {
  const marketplaceSkills = clone(STORY_MARKETPLACE_SKILLS);
  const localSkills = clone(
    options.localSkills ?? [
      {
        ...storyReleaseNotesSkill(),
        id: "local-skill-11111111-1111-4111-8111-111111111111",
        name: "Weekly summary",
        slug: "weekly-summary",
        creatorName: "Local",
        version: 1,
        versionId: "1",
      },
    ],
  );
  const localRevisions = new Map(localSkills.map((skill) => [`${skill.id}:${skill.version}`, skill]));
  let skillSubmissions = clone(STORY_SKILL_SUBMISSIONS);
  const installedSkills = new Map(Object.entries(clone(options.installedSkills ?? STORY_INSTALLED_SKILLS)));

  function readInstalledSkills(agentId: string): InstalledSkill[] {
    return installedSkills.get(agentId) ?? [];
  }

  const skills: OpenBotDesktopApi["skills"] = {
    localList: async () => clone(localSkills),
    localGet: async ({ skillId, revision }) => {
      const skill = revision
        ? localRevisions.get(`${skillId}:${revision}`)
        : localSkills.find((item) => item.id === skillId);
      if (!skill) throw new Error("Local skill not found.");
      return clone(skill);
    },
    localCreate: async ({ agentId, sourcePath }) => {
      const name = sourcePath.split("/").at(-1) || "New skill";
      const skill = {
        ...storyReleaseNotesSkill(),
        id: `local-skill-${crypto.randomUUID()}`,
        name,
        slug: name,
        creatorName: "Local",
        version: 1,
        versionId: "1",
      };
      localSkills.push(skill);
      localRevisions.set(`${skill.id}:1`, skill);
      await skills.localInstall({ agentId, skillId: skill.id, revision: 1 });
      return clone(skill);
    },
    localRevise: async ({ skillId, expectedRevision }) => {
      const index = localSkills.findIndex((item) => item.id === skillId);
      const current = localSkills[index];
      if (!current || current.version !== expectedRevision)
        throw new Error("The skill changed. Read its latest revision before revising it.");
      const skill = { ...current, version: expectedRevision + 1, versionId: String(expectedRevision + 1) };
      localSkills[index] = skill;
      localRevisions.set(`${skill.id}:${skill.version}`, skill);
      return clone(skill);
    },
    localInstall: async ({ agentId, skillId, revision }) => {
      const skill = await skills.localGet({ skillId, revision });
      const previous = readInstalledSkills(agentId).find((item) => item.skillId === skillId);
      if (previous?.state === "modified")
        throw new Error("This skill has local changes. Confirm replacement to continue.");
      const installed: InstalledSkill = {
        skillId,
        name: skill.name,
        slug: skill.slug,
        installedVersion: revision,
        availableVersion: revision,
        state: "installed",
        origin: "local",
        enabled: previous?.enabled !== false,
        description: skill.description,
      };
      installedSkills.set(agentId, [
        ...readInstalledSkills(agentId).filter((item) => item.skillId !== skillId),
        installed,
      ]);
      return clone(installed);
    },
    list: async (query) => {
      const matches = marketplaceSkills.filter(
        (skill) =>
          matchesQuery(`${skill.name} ${skill.description} ${skill.creatorName}`, query?.query) &&
          (!query?.category || skill.category === query.category) &&
          (query?.featured !== true || skill.featured),
      );
      const start = Number(query?.cursor ?? 0);
      const end = start + (query?.limit ?? 50);
      return clone({
        skills: matches.slice(start, end),
        nextCursor: end < matches.length ? String(end) : null,
      });
    },
    get: async (skillId) => {
      if (skillId.startsWith("local-skill-")) return skills.localGet({ skillId });
      const detail = STORY_MARKETPLACE_SKILL_DETAILS[skillId];
      if (!detail) throw new Error("Skill not found");
      return clone(detail);
    },
    listMine: async () => clone(skillSubmissions),
    choosePackage: async () => clone(STORY_SKILL_PACKAGE_PREVIEW),
    submit: async (input) => {
      const preview = STORY_SKILL_PACKAGE_PREVIEW;
      const submission: SkillSubmission = {
        id: `submission-${preview.slug}-${skillSubmissions.length + 1}`,
        showCreatorAvatar: input.showCreatorAvatar ?? false,
        skillId: input.skillId ?? `skill-${preview.slug}`,
        slug: preview.slug,
        name: preview.name,
        description: preview.description,
        category: input.category,
        version: 1,
        status: "pending",
        rejectionNote: null,
        iconUrl: null,
        createdAt: new Date().toISOString(),
      };
      skillSubmissions = [submission, ...skillSubmissions];
      return clone(submission);
    },
    listInstalled: async (agentId) =>
      clone(
        readInstalledSkills(agentId).map((skill) => {
          const latest = localSkills.find((item) => item.id === skill.skillId);
          return latest
            ? {
                ...skill,
                availableVersion: latest.version,
                state:
                  skill.state === "installed" && latest.version > skill.installedVersion
                    ? "update-available"
                    : skill.state,
              }
            : skill;
        }),
      ),
    install: async ({ agentId, skillId }) => {
      if (skillId.startsWith("local-skill-")) {
        const skill = await skills.localGet({ skillId });
        return skills.localInstall({ agentId, skillId, revision: skill.version });
      }
      const skill = marketplaceSkills.find((candidate) => candidate.id === skillId);
      if (!skill) throw new Error("Skill not found");
      const previous = readInstalledSkills(agentId).find((item) => item.skillId === skillId);
      const installed: InstalledSkill = {
        skillId: skill.id,
        slug: skill.slug,
        name: skill.name,
        installedVersion: skill.version,
        availableVersion: skill.version,
        state: "installed",
        enabled: previous?.enabled !== false,
        origin: previous?.origin ?? "marketplace",
        description: skill.description,
      };
      installedSkills.set(agentId, [
        ...readInstalledSkills(agentId).filter((item) => item.skillId !== skillId),
        installed,
      ]);
      return clone(installed);
    },
    uninstall: async ({ agentId, skillId }) => {
      const skill = readInstalledSkills(agentId).find((item) => item.skillId === skillId);
      if (skill?.origin === "managed") throw new Error("This skill is managed by OpenBot.");
      installedSkills.set(
        agentId,
        readInstalledSkills(agentId).filter((item) => item.skillId !== skillId),
      );
    },
    setEnabled: async ({ agentId, skillId, enabled }) => {
      const current = readInstalledSkills(agentId);
      const skill = current.find((item) => item.skillId === skillId);
      if (!skill) throw new Error("Skill not found.");
      if (skill.origin === "managed") throw new Error("This skill is managed by OpenBot.");
      const next: InstalledSkill = { ...skill, enabled };
      installedSkills.set(
        agentId,
        current.map((item) => (item.skillId === skillId ? next : item)),
      );
      return clone(next);
    },
  };

  return { skills, installedSkills, readInstalledSkills };
}
