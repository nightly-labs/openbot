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
import { GITHUB_SKILL_ID_MAX_LENGTH } from "@openbot/contracts/ipc";
import { sourceText } from "@openbot/i18n/source";
import { Effect } from "effect";
import { z } from "zod";
import { ToolOperationFailed, toolStep } from "./tool-operation";

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
const installedSkillId = z.string().trim().min(1).max(GITHUB_SKILL_ID_MAX_LENGTH);
export const installLocalSkillSchema = z.object({ agentId: targetAgentId, skillId, revision }).strict();
const setSkillEnabledSchema = z
  .object({ agentId: targetAgentId, skillId: installedSkillId, enabled: z.boolean() })
  .strict();
const uninstallSkillSchema = z.object({ agentId: targetAgentId, skillId: installedSkillId }).strict();

const hasLocalChanges = (cause: unknown) =>
  cause instanceof Error && cause.message === sourceText("error.skill.replaceModified");

function userReplaceStep(ownAgent: boolean): string {
  return [
    "This skill has local changes, and only the user can replace them.",
    ownAgent ? "Call openbot.show_setting with agent.skills." : "The user opens that agent's settings.",
    "In Skills, the user selects Repair in the skill's menu, then Replace skill: when the user confirms, this installs the newest revision and discards the local changes.",
    `Only an owner or admin can do this, in the desktop app or the web client${ownAgent ? "; the card has an Open button only in the user's own chat with you on a computer" : ""}.`,
    "Do not retry install_local_skill, revise the skill again, or change the installed copy.",
  ].join(" ");
}

const localChangesFailure = (text: string) => Effect.fail(new ToolOperationFailed({ cause: new Error(text) }));

export interface UnreadableLocalSkill {
  skillId: string;
  error: string;
}

export interface LocalSkillListing {
  skills: MarketplaceSkillDetail[];
  unreadable: UnreadableLocalSkill[];
}

export interface LocalSkillTools {
  create(input: CreateLocalSkillInput): Effect.Effect<MarketplaceSkillDetail, ToolOperationFailed>;
  revise(input: ReviseLocalSkillInput): Effect.Effect<MarketplaceSkillDetail, ToolOperationFailed>;
  list(): Effect.Effect<LocalSkillListing, ToolOperationFailed>;
  get(
    input: LocalSkillRevisionInput,
  ): Effect.Effect<MarketplaceSkillDetail & { archivePath: string }, ToolOperationFailed>;
  install(
    input: LocalSkillRevisionInput & { agentId: string; revision: number },
  ): Effect.Effect<InstalledSkill, ToolOperationFailed>;
  listInstalled(agentId: string): Effect.Effect<InstalledSkill[], ToolOperationFailed>;
  setEnabled(input: SetEnabledSkillInput): Effect.Effect<InstalledSkill, ToolOperationFailed>;
  uninstall(input: UninstallSkillInput): Effect.Effect<void, ToolOperationFailed>;
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
      "Publish a local skill revision from a workspace folder when the user asks. Read first; supply expectedRevision. Installs for you only. Never edit installed copies: it blocks updates.",
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

export const runLocalSkillTool = Effect.fn("SkillTools.run")(function* (
  api: LocalSkillTools,
  agentId: string,
  tool: string,
  args: unknown,
  targetAgent: (agentId: string | undefined) => string,
  onChanged?: (event: SkillConversationEvent) => void,
) {
  switch (tool) {
    case "create_skill": {
      const input = yield* toolStep(() => createSkillSchema.parse(args));
      const skill = yield* api.create({ agentId, ...input });
      onChanged?.({ action: "created", skillId: skill.id, revision: skill.version, skillName: skill.name });
      return skillToolDetail(skill);
    }
    case "revise_skill": {
      const input = yield* toolStep(() => reviseSkillSchema.parse(args));
      const skill = yield* api.revise({ agentId, ...input }).pipe(
        Effect.catchIf(
          (failure) => failure.cause instanceof Error && hasLocalChanges(failure.cause.cause),
          () =>
            localChangesFailure(
              `Skill ${input.skillId} was saved as revision ${input.expectedRevision + 1}, but your installed copy was not replaced. ${userReplaceStep(true)}`,
            ),
        ),
      );
      onChanged?.({ action: "revised", skillId: skill.id, revision: skill.version, skillName: skill.name });
      return skillToolDetail(skill);
    }
    case "read_local_skill": {
      const input = yield* toolStep(() => readSkillSchema.parse(args));
      const skill = yield* api.get({
        skillId: input.skillId,
        ...(input.revision === undefined ? {} : { revision: input.revision }),
      });
      return { ...skillToolDetail(skill), archivePath: skill.archivePath };
    }
    case "install_local_skill": {
      const input = yield* toolStep(() => installLocalSkillSchema.parse(args));
      const target = yield* toolStep(() => targetAgent(input.agentId));
      const skill = yield* api.install({ ...input, agentId: target }).pipe(
        Effect.catchIf(
          (failure) => hasLocalChanges(failure.cause),
          () =>
            localChangesFailure(
              `${userReplaceStep(target === agentId)} If the user needs revision ${input.revision} exactly, ask the user before they use Repair, because Repair installs the newest revision.`,
            ),
        ),
      );
      onChanged?.({
        action: "installed",
        skillId: skill.skillId,
        revision: skill.installedVersion,
        skillName: skill.name,
      });
      return skill;
    }
    case "list_local_skills": {
      const { skills, unreadable } = yield* api.list();
      const listed = skills.map(skillToolSummary);
      return unreadable.length ? { skills: listed, unreadable } : listed;
    }
    case "set_skill_enabled": {
      const input = yield* toolStep(() => setSkillEnabledSchema.parse(args));
      const target = yield* toolStep(() => targetAgent(input.agentId));
      return yield* api.setEnabled({ ...input, agentId: target });
    }
    case "uninstall_skill": {
      const input = yield* toolStep(() => uninstallSkillSchema.parse(args));
      const target = yield* toolStep(() => targetAgent(input.agentId));
      const installed = yield* api.listInstalled(target);
      if (!installed.some((skill) => skill.skillId === input.skillId && skill.origin !== "workspace")) {
        return yield* new ToolOperationFailed({ cause: new Error(sourceText("error.skill.notFound")) });
      }
      yield* api.uninstall({ agentId: target, skillId: input.skillId });
      return { agentId: target, skillId: input.skillId, removed: true };
    }
    default:
      return yield* new ToolOperationFailed({ cause: new Error("Unknown local skill tool.") });
  }
});
