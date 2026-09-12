import { INPUT_LIMITS } from "@openbot/contracts/input-limits";
import type {
  CreateLocalSkillInput,
  InstalledSkill,
  LocalSkillRevisionInput,
  MarketplaceSkillDetail,
  ReviseLocalSkillInput,
} from "@openbot/contracts/ipc";
import { z } from "zod";

const sourcePath = z.string().min(1).max(INPUT_LIMITS.path);
const skillId = z.string().regex(/^local-skill-[\da-f-]{36}$/u);
const revision = z.number().int().positive().max(Number.MAX_SAFE_INTEGER);
export const createSkillSchema = z.object({ sourcePath }).strict();
export const reviseSkillSchema = z.object({ skillId, expectedRevision: revision, sourcePath }).strict();
export const readSkillSchema = z.object({ skillId, revision: revision.optional() }).strict();
export const installLocalSkillSchema = z.object({ skillId, revision }).strict();

export interface LocalSkillTools {
  create(input: CreateLocalSkillInput): Promise<MarketplaceSkillDetail>;
  revise(input: ReviseLocalSkillInput): Promise<MarketplaceSkillDetail>;
  list(): Promise<MarketplaceSkillDetail[]>;
  get(input: LocalSkillRevisionInput): Promise<MarketplaceSkillDetail>;
  install(input: LocalSkillRevisionInput & { agentId: string; revision: number }): Promise<InstalledSkill>;
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
      "Install a selected local skill revision for your current agent when the user asks to add or update it. Preserves disabled state and refuses to overwrite modified files.",
    shape: installLocalSkillSchema.shape,
  },
];

export async function runLocalSkillTool(api: LocalSkillTools, agentId: string, tool: string, args: unknown) {
  switch (tool) {
    case "create_skill":
      return api.create({ agentId, ...createSkillSchema.parse(args) });
    case "revise_skill":
      return api.revise({ agentId, ...reviseSkillSchema.parse(args) });
    case "read_local_skill":
      return api.get(readSkillSchema.parse(args));
    case "install_local_skill":
      return api.install({ agentId, ...installLocalSkillSchema.parse(args) });
    case "list_local_skills":
      return api.list();
    default:
      throw new Error("Unknown local skill tool.");
  }
}
