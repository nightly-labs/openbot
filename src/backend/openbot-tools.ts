import { INPUT_LIMITS } from "@openbot/contracts/input-limits";
import { z } from "zod";
import { createAgentToolSchema, updateProfileToolSchema } from "./agent/profile-tools";
import {
  assignAgentSectionToolSchema,
  createSectionToolSchema,
  deleteSectionToolSchema,
  renameSectionToolSchema,
} from "./agent/sidebar-tools";
import { LOCAL_SKILL_TOOL_DEFINITIONS } from "./agent/skill-tools";
import { CHANNEL_TOOL_DEFINITIONS } from "./channel-tools";
import { routineScheduleZodSchema } from "./routine-tool-schema";

interface OpenBotToolDefinition {
  name: string;
  description: string;
  shape: z.ZodRawShape;
}

const watcherSourceZodSchema = z.union([
  z.strictObject({
    kind: z.literal("gmail"),
    query: z.string().min(1).max(INPUT_LIMITS.watcherQuery),
    labelIds: z.array(z.string().min(1).max(INPUT_LIMITS.identifier)).max(10).optional(),
  }),
  z.strictObject({ kind: z.literal("web"), url: z.string().min(1).max(INPUT_LIMITS.browserUrl) }),
]);

const watcherSelectorZodSchema = z
  .strictObject({
    css: z.string().min(1).max(INPUT_LIMITS.watcherSelector).optional(),
    xpath: z.string().min(1).max(INPUT_LIMITS.watcherSelector).optional(),
    textAnchor: z.string().min(1).max(INPUT_LIMITS.watcherText).optional(),
  })
  .nullable();

const watcherConditionZodSchema = z.strictObject({
  textContains: z.string().min(1).max(INPUT_LIMITS.watcherText).optional(),
});

/** Shared declarations for Codex, Grok, and Claude. Service handlers enforce execution rules. */
export const OPENBOT_TOOL_DEFINITIONS: readonly OpenBotToolDefinition[] = [
  ...CHANNEL_TOOL_DEFINITIONS,
  ...LOCAL_SKILL_TOOL_DEFINITIONS,
  {
    name: "list_sites",
    description: "List static sites hosted by the signed-in OpenBot user. Use this before retrying a hosting mutation.",
    shape: {},
  },
  {
    name: "publish_site",
    description:
      "Publish a new static site after the user explicitly asks to publish it. The source must be inside this agent's workspace or OpenBot Shared.",
    shape: {
      sourcePath: z.string().min(1).max(INPUT_LIMITS.path),
      title: z.string().min(1).max(120),
      description: z.string().min(1).max(500),
      spaFallback: z.boolean().optional(),
    },
  },
  {
    name: "replace_site",
    description:
      "Replace an owned static site after the user explicitly asks to replace it. This keeps the URL and resets expiry to 30 days.",
    shape: {
      siteId: z.string().min(1).max(INPUT_LIMITS.identifier),
      sourcePath: z.string().min(1).max(INPUT_LIMITS.path),
      title: z.string().min(1).max(120),
      description: z.string().min(1).max(500),
      spaFallback: z.boolean().optional(),
    },
  },
  {
    name: "delete_site",
    description: "Delete an owned static site after the user explicitly asks to delete it.",
    shape: { siteId: z.string().min(1).max(INPUT_LIMITS.identifier) },
  },
  {
    name: "attach_files_to_response",
    description:
      "Attach existing local files to the current response for the user. Use this after creating screenshots, charts, diagrams, reports, or other files that the user should receive. OpenBot copies each file and shows image previews in the conversation.",
    shape: { paths: z.array(z.string().min(1).max(INPUT_LIMITS.path)).min(1).max(INPUT_LIMITS.attachments) },
  },
  {
    name: "list_sections",
    description:
      "List sidebar sections (folders), their stable ids, and agent assignments before choosing message recipients or grouping agents.",
    shape: {},
  },
  {
    name: "create_section",
    description:
      "Create a sidebar section (folder) to group existing agents. List sections first and reuse an existing matching section.",
    shape: createSectionToolSchema.shape,
  },
  {
    name: "rename_section",
    description: "Rename an existing custom sidebar section.",
    shape: renameSectionToolSchema.shape,
  },
  {
    name: "delete_section",
    description: "Delete a custom sidebar section without deleting its agents; its agents become ungrouped.",
    shape: deleteSectionToolSchema.shape,
  },
  {
    name: "assign_agent_section",
    description: "Move an existing agent into a sidebar section. Pass null for sectionId to ungroup it.",
    shape: assignAgentSectionToolSchema.shape,
  },
  {
    name: "list_agents",
    description: "List local OpenBot agents with their name, title, description, and current status.",
    shape: {},
  },
  {
    name: "create_agent",
    description:
      "Create a persistent local OpenBot agent when the user asks for a new teammate. Choose its profile from the user's request and supply its first task. Use update_profile for an existing agent.",
    shape: createAgentToolSchema.shape,
  },
  {
    name: "update_profile",
    description:
      "Update a local OpenBot agent’s name, title, instructions, or avatar from the user’s request. For an uploaded or local image, use avatarPath. Prepare a PNG, JPEG, or WebP copy up to 512 KB with your available tools if needed.",
    shape: updateProfileToolSchema.shape,
  },
  {
    name: "list_routines",
    description:
      "List routines for this agent, or for another local agent when agentId is provided. Use this before updating or deleting a routine.",
    shape: { agentId: z.string().min(1).max(INPUT_LIMITS.identifier).optional() },
  },
  {
    name: "create_routine",
    description:
      "Create a scheduled routine for this agent, or for another local agent when agentId is provided. It is active by default and uses the host timezone by default. Interval, advanced-every, and custom schedules must not run more often than every 3 minutes. When watching a folder for new files and no interval was requested, use a 15 minute interval and keep the folder path plus handling instructions in the routine instruction.",
    shape: {
      agentId: z.string().min(1).max(INPUT_LIMITS.identifier).optional(),
      name: z.string().min(1).max(INPUT_LIMITS.routineName),
      instruction: z.string().min(1).max(INPUT_LIMITS.routineInstruction),
      schedule: routineScheduleZodSchema.describe(
        "Routine schedule. Interval, advanced-every, and custom schedules must not run more often than every 3 minutes.",
      ),
      active: z.boolean().optional(),
      timezone: z.string().min(1).max(128).describe("IANA timezone such as Europe/Warsaw.").optional(),
    },
  },
  {
    name: "update_routine",
    description:
      "Update, pause, or resume an existing routine for this agent, or for another local agent when agentId is provided. Replacement schedules must not run more often than every 3 minutes.",
    shape: {
      agentId: z.string().min(1).max(INPUT_LIMITS.identifier).optional(),
      routineId: z.string().min(1).max(INPUT_LIMITS.identifier),
      name: z.string().min(1).max(INPUT_LIMITS.routineName).optional(),
      instruction: z.string().min(1).max(INPUT_LIMITS.routineInstruction).optional(),
      schedule: routineScheduleZodSchema
        .describe("Routine schedule. Must not run more often than every 3 minutes.")
        .optional(),
      active: z.boolean().optional(),
    },
  },
  {
    name: "delete_routine",
    description: "Delete an existing routine for this agent, or for another local agent when agentId is provided.",
    shape: {
      agentId: z.string().min(1).max(INPUT_LIMITS.identifier).optional(),
      routineId: z.string().min(1).max(INPUT_LIMITS.identifier),
    },
  },
  {
    name: "test_routine",
    description:
      "Queue one manual test run of an existing routine for this agent, or for another local agent when agentId is provided.",
    shape: {
      agentId: z.string().min(1).max(INPUT_LIMITS.identifier).optional(),
      routineId: z.string().min(1).max(INPUT_LIMITS.identifier),
    },
  },
  {
    name: "list_watchers",
    description:
      "List event watchers for this agent, or for another local agent when agentId is provided. A watcher polls one source and fires its linked routine only on real change.",
    shape: { agentId: z.string().min(1).max(INPUT_LIMITS.identifier).optional() },
  },
  {
    name: "create_watcher",
    description:
      "Create an event watcher that polls one source and fires a routine only on real change. Link routineId from openbot.list_routines. Gmail source needs a Gmail search query. Web source needs an https URL. Interval must be 3 to 1440 minutes; use 15 when the user gives none.",
    shape: {
      agentId: z.string().min(1).max(INPUT_LIMITS.identifier).optional(),
      routineId: z.string().min(1).max(INPUT_LIMITS.identifier),
      name: z.string().min(1).max(INPUT_LIMITS.watcherName),
      source: watcherSourceZodSchema,
      intervalMinutes: z.number().int().min(3).max(1440).optional(),
      active: z.boolean().optional(),
      selector: watcherSelectorZodSchema.optional(),
      condition: watcherConditionZodSchema.optional(),
    },
  },
  {
    name: "update_watcher",
    description:
      "Update, pause, or resume an event watcher for this agent, or for another local agent when agentId is provided.",
    shape: {
      agentId: z.string().min(1).max(INPUT_LIMITS.identifier).optional(),
      watcherId: z.string().min(1).max(INPUT_LIMITS.identifier),
      name: z.string().min(1).max(INPUT_LIMITS.watcherName).optional(),
      intervalMinutes: z.number().int().min(3).max(1440).optional(),
      active: z.boolean().optional(),
      source: watcherSourceZodSchema.optional(),
      selector: watcherSelectorZodSchema.optional(),
      condition: watcherConditionZodSchema.optional(),
    },
  },
  {
    name: "delete_watcher",
    description: "Delete an event watcher for this agent, or for another local agent when agentId is provided.",
    shape: {
      agentId: z.string().min(1).max(INPUT_LIMITS.identifier).optional(),
      watcherId: z.string().min(1).max(INPUT_LIMITS.identifier),
    },
  },
  {
    name: "pause_watcher",
    description: "Pause an event watcher so its checks stop until resumed. The watcher keeps its state.",
    shape: {
      agentId: z.string().min(1).max(INPUT_LIMITS.identifier).optional(),
      watcherId: z.string().min(1).max(INPUT_LIMITS.identifier),
    },
  },
  {
    name: "resume_watcher",
    description: "Resume a paused event watcher. Its next check runs after one full interval.",
    shape: {
      agentId: z.string().min(1).max(INPUT_LIMITS.identifier).optional(),
      watcherId: z.string().min(1).max(INPUT_LIMITS.identifier),
    },
  },
  {
    name: "test_watcher",
    description:
      "Run one immediate check of an event watcher and return its latest matches without waiting for the schedule.",
    shape: {
      agentId: z.string().min(1).max(INPUT_LIMITS.identifier).optional(),
      watcherId: z.string().min(1).max(INPUT_LIMITS.identifier),
    },
  },
  {
    name: "list_watcher_matches",
    description: "List recent matches for an event watcher so the routine can process what changed.",
    shape: {
      agentId: z.string().min(1).max(INPUT_LIMITS.identifier).optional(),
      watcherId: z.string().min(1).max(INPUT_LIMITS.identifier),
      limit: z.number().int().min(1).max(INPUT_LIMITS.watcherMatchesPage).optional(),
    },
  },
  {
    name: "remember",
    description:
      "Stage one short, durable memory for this agent. Use memoryId to correct or consolidate an existing memory. The change commits only if the current turn completes.",
    shape: {
      text: z.string().min(1).max(INPUT_LIMITS.agentMemoryText),
      memoryId: z.string().optional(),
    },
  },
  {
    name: "forget_memory",
    description:
      "Stage deletion of one saved memory when the user asks you to forget it. The change commits only if the current turn completes.",
    shape: { memoryId: z.string().min(1) },
  },
  {
    name: "ask_user",
    description:
      "Ask the user 1–3 short questions and wait for structured answers. Use this instead of asking questions in a normal assistant message whenever clarification or a choice is needed.",
    shape: {
      questions: z
        .array(
          z.strictObject({
            id: z.string().max(INPUT_LIMITS.identifier).optional(),
            header: z.string().max(INPUT_LIMITS.promptHeader).optional(),
            question: z.string().min(1).max(INPUT_LIMITS.promptQuestion),
            isSecret: z.boolean().optional(),
            options: z
              .array(
                z.strictObject({
                  label: z.string().min(1).max(INPUT_LIMITS.promptOptionLabel),
                  description: z.string().max(INPUT_LIMITS.promptOptionDescription).optional(),
                }),
              )
              .max(INPUT_LIMITS.promptOptions)
              .optional(),
          }),
        )
        .min(1)
        .max(3),
    },
  },
  {
    name: "react_to_user_message",
    description:
      "Add one emoji reaction to the current user message for an obvious positive or negative emotional moment, including wins, affection, gratitude, humor, sadness, disappointment, frustration, empathy, or strong approval. An emoji in the written answer does not count as a reaction. Skip neutral messages and never use the reaction instead of the normal answer.",
    shape: { emoji: z.string().min(1).max(64).describe("Exactly one complete Unicode emoji.") },
  },
  {
    name: "send_message",
    description:
      "Queue an asynchronous message and optional local files for one or more OpenBot agents. When replying, pass the original message id as replyToMessageId.",
    shape: {
      recipientAgentIds: z.array(z.string()).min(1).max(32),
      text: z.string().min(1).max(100_000),
      paths: z.array(z.string()).max(10).optional(),
      replyToMessageId: z.string().nullable().optional(),
    },
  },
];

export const OPENBOT_DYNAMIC_TOOLS = {
  type: "namespace",
  name: "openbot",
  description: "Attach files to the current response and work with persistent OpenBot teammates.",
  tools: OPENBOT_TOOL_DEFINITIONS.map((definition) => ({
    type: "function" as const,
    name: definition.name,
    description: definition.description,
    inputSchema: z.toJSONSchema(z.strictObject(definition.shape), { target: "draft-7" }),
  })),
} as const;
