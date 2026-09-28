import { INPUT_LIMITS } from "@openbot/contracts/input-limits";
import type {
  CreateLocalSkillInput,
  InstalledSkill,
  LocalSkillRevisionInput,
  MarketplaceSkillDetail,
  ReviseLocalSkillInput,
  SetEnabledSkillInput,
  SkillConversationEvent,
  UninstallSkillInput,
} from "@openbot/contracts/ipc";
import { sourceText } from "@openbot/i18n/source";
import { z } from "zod";

const sourcePath = z.string().min(1).max(INPUT_LIMITS.path);
const skillId = z.string().regex(/^local-skill-[\da-f-]{36}$/u);
const revision = z.number().int().positive().max(Number.MAX_SAFE_INTEGER);
export const createSkillSchema = z.object({ sourcePath }).strict();
export const reviseSkillSchema = z.object({ skillId, expectedRevision: revision, sourcePath }).strict();
export const readSkillSchema = z.object({ skillId, revision: revision.optional() }).strict();
const targetAgentId = z
  .string()
  .trim()
  .min(1)
  .max(INPUT_LIMITS.identifier)
  .describe("Stable id of the agent to change, from list_agents. Omit it to change your own agent.")
  .optional();
// An installed skill can come from the marketplace too, so its id is not always a local skill id.
const installedSkillId = z.string().trim().min(1).max(INPUT_LIMITS.identifier);
export const installLocalSkillSchema = z.object({ agentId: targetAgentId, skillId, revision }).strict();
export const setSkillEnabledSchema = z
  .object({ agentId: targetAgentId, skillId: installedSkillId, enabled: z.boolean() })
  .strict();
export const uninstallSkillSchema = z.object({ agentId: targetAgentId, skillId: installedSkillId }).strict();

export interface LocalSkillTools {
  create(input: CreateLocalSkillInput): Promise<MarketplaceSkillDetail>;
  revise(input: ReviseLocalSkillInput): Promise<MarketplaceSkillDetail>;
  list(): Promise<MarketplaceSkillDetail[]>;
  get(input: LocalSkillRevisionInput): Promise<MarketplaceSkillDetail & { archivePath: string }>;
  install(input: LocalSkillRevisionInput & { agentId: string; revision: number }): Promise<InstalledSkill>;
  listInstalled(agentId: string): Promise<InstalledSkill[]>;
  setEnabled(input: SetEnabledSkillInput): Promise<InstalledSkill>;
  uninstall(input: UninstallSkillInput): Promise<void>;
}

export const LOCAL_SKILL_TOOL_DEFINITIONS = [
  {
    name: "create_skill",
    description:
      "Create a reusable local skill from a folder inside your workspace after the user asks to create a skill. Follow openbot-skill-creator. Saves to the shared local library and installs for you. Does not publish or execute scripts.",
    shape: createSkillSchema.shape,
  },
  {
    name: "revise_skill",
    description:
      "Publish a new local skill revision from a workspace folder when the user asks to revise it. Read first and supply expectedRevision. Installed copies stay unchanged until explicitly updated.",
    shape: reviseSkillSchema.shape,
  },
  {
    name: "list_local_skills",
    description: "List shared skills stored on this computer, including their current revisions.",
    shape: {},
  },
  {
    name: "read_local_skill",
    description: "Read a local skill's instructions, file list and revision before using or revising it.",
    shape: readSkillSchema.shape,
  },
  {
    name: "install_local_skill",
    description:
      "Install a selected local skill revision for yourself or another local agent when the user asks to add or update it. Omit agentId for yourself. Preserves disabled state and refuses to overwrite modified files.",
    shape: installLocalSkillSchema.shape,
  },
  {
    name: "set_skill_enabled",
    description:
      "Turn an installed skill on or off for yourself or another local agent. Omit agentId for yourself. Get the skillId from read_agent. Refuses to turn off a skill whose files were changed.",
    shape: setSkillEnabledSchema.shape,
  },
  {
    name: "uninstall_skill",
    description:
      "Remove an installed skill from yourself or another local agent when the user asks. Omit agentId for yourself. Get the skillId from read_agent. Refuses to remove a skill whose files were changed; only the user can remove those. Cannot remove a workspace folder skill. The local library keeps the skill.",
    shape: uninstallSkillSchema.shape,
  },
];

function skillToolSummary(skill: MarketplaceSkillDetail) {
  return {
    id: skill.id,
    slug: skill.slug,
    name: skill.name,
    description: skill.description,
    version: skill.version,
    updatedAt: skill.updatedAt,
  };
}

function skillToolDetail(skill: MarketplaceSkillDetail) {
  return {
    ...skillToolSummary(skill),
    files: skill.files,
    instructions: skill.instructions,
    ...(skill.examplePrompt ? { examplePrompt: skill.examplePrompt } : {}),
  };
}

/**
 * `agentId` is the calling agent: it owns the skills it creates and revises. `targetAgent` resolves
 * the agent that an install, enable, or uninstall changes, which is the caller when `agentId` is omitted.
 */
export async function runLocalSkillTool(
  api: LocalSkillTools,
  agentId: string,
  tool: string,
  args: unknown,
  targetAgent: (agentId: string | undefined) => string,
  onChanged?: (event: SkillConversationEvent) => void,
) {
  switch (tool) {
    case "create_skill": {
      const skill = await api.create({ agentId, ...createSkillSchema.parse(args) });
      onChanged?.({ action: "created", skillId: skill.id, revision: skill.version, skillName: skill.name });
      return skillToolDetail(skill);
    }
    case "revise_skill": {
      const skill = await api.revise({ agentId, ...reviseSkillSchema.parse(args) });
      onChanged?.({ action: "revised", skillId: skill.id, revision: skill.version, skillName: skill.name });
      return skillToolDetail(skill);
    }
    case "read_local_skill": {
      const skill = await api.get(readSkillSchema.parse(args));
      return { ...skillToolDetail(skill), archivePath: skill.archivePath };
    }
    case "install_local_skill": {
      const input = installLocalSkillSchema.parse(args);
      const skill = await api.install({ ...input, agentId: targetAgent(input.agentId) });
      onChanged?.({
        action: "installed",
        skillId: skill.skillId,
        revision: skill.installedVersion,
        skillName: skill.name,
      });
      return skill;
    }
    case "list_local_skills":
      return (await api.list()).map(skillToolSummary);
    case "set_skill_enabled": {
      const input = setSkillEnabledSchema.parse(args);
      return api.setEnabled({ ...input, agentId: targetAgent(input.agentId) });
    }
    case "uninstall_skill": {
      const input = uninstallSkillSchema.parse(args);
      const target = targetAgent(input.agentId);
      // The service ignores an id that is not in the lock file, and workspace folder skills are never in it.
      const installed = await api.listInstalled(target);
      if (!installed.some((skill) => skill.skillId === input.skillId && skill.origin !== "workspace")) {
        throw new Error(sourceText("error.skill.notFound"));
      }
      // Never `removeModified`: files the user changed are theirs to remove.
      await api.uninstall({ agentId: target, skillId: input.skillId });
      return { agentId: target, skillId: input.skillId, removed: true };
    }
    default:
      throw new Error("Unknown local skill tool.");
  }
}
