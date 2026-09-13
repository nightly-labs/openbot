import { join } from "node:path";
import type { LocalSkillTools } from "../backend/agent/skill-tools";
import type { SkillMarketplaceService } from "./skill-marketplace-service";

export function localSkillTools(skills: SkillMarketplaceService): LocalSkillTools {
  const library = skills.requireLocalLibrary();
  return {
    list: () => library.list(),
    get: async (input) => {
      const detail = await library.get(input.skillId, input.revision);
      return { ...detail, archivePath: join(library.root, detail.id, String(detail.version), "bundle.zip") };
    },
    revise: (input) => library.revise(input.agentId, input.skillId, input.expectedRevision, input.sourcePath),
    install: (input) => skills.installLocal(input),
    create: async (input) => {
      const skill = await library.create(input.agentId, input.sourcePath);
      try {
        await skills.installLocal({ agentId: input.agentId, skillId: skill.id, revision: skill.version });
      } catch {
        throw new Error(
          `Skill ${skill.id} was saved as revision ${skill.version}, but installation failed. Read it and retry install_local_skill; do not create it again.`,
        );
      }
      return skill;
    },
  };
}
