import {
  CHAT_VISUAL_HTML_LIMIT,
  CHAT_VISUAL_MAX_HEIGHT,
  CHAT_VISUAL_MIN_HEIGHT,
  CHAT_VISUAL_TITLE_LIMIT,
} from "@openbot/contracts/chat-visual";
import { INPUT_LIMITS } from "@openbot/contracts/input-limits";
import { z } from "zod";
import { interruptAgentToolSchema } from "./agent/agent-interrupt-tool";
import { DATA_TOOL_DEFINITIONS } from "./agent/data-tools";
import {
  createAgentToolSchema,
  listModelsToolSchema,
  readAgentToolSchema,
  updateProfileToolSchema,
} from "./agent/profile-tools";
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

/** The page rules for `html_render` and `html_preview`. The names match the variables that `ChatVisual` sends. */
const VISUAL_PAGE_RULES = [
  "Write one self-contained HTML document with inline <style> and <script>. Remote http(s) files, such as a chart library from a CDN, load as they are; local file paths do not load.",
  "The page runs in a sandbox: it cannot use cookies, storage, pop-up windows or the OpenBot app. A click on an http(s) link opens the link in the user's browser.",
  "The frame has no border and sits on the chat background, as wide as the reply column (about 360px on phones). Leave html and body with no background, use a fluid width and no outer card or banner title: the page is part of your reply.",
  "Give charts fixed pixel heights. Let the content set the page height; do not use 100vh or height:100% on html or body. The frame cuts what is outside the page box, so highlight a box with its border, not an outline or an outer shadow.",
  "OpenBot sets these CSS variables on :root from the app theme, which is dark on the desktop: --background (transparent), --foreground, --muted-foreground, --muted, --card, --card-foreground, --border, --accent, --destructive, --success, --chart-1 to --chart-6, --radius, --font-sans, --font-mono. The base style sets the body font and color from them.",
].join(" ");

export const htmlRenderToolSchema = z.object({
  html: z.string().min(1).max(CHAT_VISUAL_HTML_LIMIT).describe("A complete, self-contained HTML document."),
  title: z.string().trim().min(1).max(CHAT_VISUAL_TITLE_LIMIT).describe("A short name for the page."),
  height: z
    .number()
    .int()
    .min(CHAT_VISUAL_MIN_HEIGHT)
    .max(CHAT_VISUAL_MAX_HEIGHT)
    .optional()
    .describe(
      `The highest frame height in CSS pixels, ${CHAT_VISUAL_MIN_HEIGHT}-${CHAT_VISUAL_MAX_HEIGHT}. Omit it to fit the whole page.`,
    ),
});

export const CHAT_VISUAL_PREVIEW_MIN_WIDTH = 240;
export const CHAT_VISUAL_PREVIEW_MAX_WIDTH = 1_600;
/** The width of the reply column in a desktop chat. */
export const CHAT_VISUAL_PREVIEW_DEFAULT_WIDTH = 728;

export const htmlPreviewToolSchema = z.object({
  html: z.string().min(1).max(CHAT_VISUAL_HTML_LIMIT).describe("A complete, self-contained HTML document."),
  width: z
    .number()
    .int()
    .min(CHAT_VISUAL_PREVIEW_MIN_WIDTH)
    .max(CHAT_VISUAL_PREVIEW_MAX_WIDTH)
    .optional()
    .describe(
      `The page width in CSS pixels, ${CHAT_VISUAL_PREVIEW_MIN_WIDTH}-${CHAT_VISUAL_PREVIEW_MAX_WIDTH}. The default is ${CHAT_VISUAL_PREVIEW_DEFAULT_WIDTH}, the desktop reply column; use 360 to check a phone.`,
    ),
  appearance: z.enum(["dark", "light"]).optional().describe("The app theme to draw with. The default is dark."),
});

/** Shared declarations for Codex, Grok, and Claude. Service handlers enforce execution rules. */
export const OPENBOT_TOOL_DEFINITIONS: readonly OpenBotToolDefinition[] = [
  ...CHANNEL_TOOL_DEFINITIONS,
  ...DATA_TOOL_DEFINITIONS,
  ...LOCAL_SKILL_TOOL_DEFINITIONS,
  {
    name: "list_sites",
    description:
      "List the static sites of this OpenBot server, with its site limit and the slots in use. Use this before retrying a hosting mutation.",
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
    name: "html_preview",
    description: `Draw an HTML page out of view and get a screenshot, the content height and the console output. The user does not see it. Use it to check a page before you call html_render, and correct what the screenshot or the console shows. ${VISUAL_PAGE_RULES}`,
    shape: htmlPreviewToolSchema.shape,
  },
  {
    name: "html_render",
    description: `Show a finished HTML page (chart, table, diagram, collage, mockup) in this conversation, above your final text reply; call it before you write that reply. The user already sees the page, so the reply must not announce it or restate it: add only what the page does not say. OpenBot fits the frame to the page height. A height lower than the page caps the frame, and the rest scrolls in it. ${VISUAL_PAGE_RULES}`,
    shape: htmlRenderToolSchema.shape,
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
    description:
      "List local OpenBot agents with their name, title, description, and progress: status (working, queued, or ready), queuedMessages, turnStartedAt while working, and lastActivityAt. OpenBot does not track which files an agent changed.",
    shape: {},
  },
  {
    name: "list_models",
    description:
      "List the models each provider offers for a new agent: id, name, reasoning efforts, and the default model that create_agent uses when you give only a provider. Read-only.",
    shape: listModelsToolSchema.shape,
  },
  {
    name: "interrupt_agent",
    description:
      "Stop another agent's current turn when that turn works on your message, and cancel your requests still queued for it. The agent receives a notice from you with the reason. You cannot stop work that the user, a routine, a channel, or another agent started. To give new work, call send_message after this tool.",
    shape: interruptAgentToolSchema.shape,
  },
  {
    name: "read_agent",
    description:
      "Read the setup of one local OpenBot agent, or your own when you omit agentId: profile, provider, model, reasoning effort, access, Computer Use, notifications, auto-approve, installed skills, routines, and the MCP servers it gets. Read-only. Call it before you change another agent.",
    shape: readAgentToolSchema.shape,
  },
  {
    name: "create_agent",
    description:
      "Create a persistent local OpenBot agent when the user asks for a new teammate. Choose its profile from the user's request and supply its first task. The new agent gets your provider, model, and reasoning effort. Set provider, model, or reasoningEffort only when the user asks for different ones; call list_models first. Use update_profile for an existing agent. After it exists, add skills with install_local_skill and routines with create_routine as needed. A new agent gets your own access and Computer Use limits.",
    shape: createAgentToolSchema.shape,
  },
  {
    name: "update_profile",
    description:
      "Update a local OpenBot agent’s name, title, instructions, avatar, provider, model, reasoning effort, access, Computer Use, or notifications from the user’s request. You can restrict access to workspace and turn Computer Use off; only the user can widen them again. For an uploaded or local image, use avatarPath. Prepare a PNG, JPEG, or WebP copy up to 512 KB with your available tools if needed. Call list_models before you change a model. A new model applies from the agent's next turn. A provider change fails while the agent has a turn or queued messages; try again when it is ready.",
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
      "Create a scheduled routine for this agent, or for another local agent when agentId is provided. It is active by default. Without a timezone, it uses the timezone of the person whose message this turn answers, or the host timezone when that is unknown. Interval, advanced-every, and custom schedules must not run more often than every 3 minutes. When watching a folder for new files and no interval was requested, use a 15 minute interval and keep the folder path plus handling instructions in the routine instruction.",
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
    name: "suggest_marketplace_app",
    description:
      "Show the user a card in this conversation for one Marketplace app that the task needs and that is not in your tools. The user connects it, opens its listing, or dismisses the card; nothing connects without the user. Keep your normal answer.",
    shape: {
      app: z
        .string()
        .min(1)
        .max(63)
        .describe(
          "The plugin slug: its name in lower case with hyphens, such as notion or linear. Use github for GitHub.",
        ),
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
      "Queue an asynchronous message and optional local files for one or more OpenBot agents. When replying, pass the original message id as replyToMessageId. Set expectsReply false to pass information on without asking the recipient for an answer.",
    shape: {
      recipientAgentIds: z.array(z.string()).min(1).max(32),
      text: z.string().min(1).max(100_000),
      paths: z.array(z.string()).max(10).optional(),
      replyToMessageId: z.string().nullable().optional(),
      expectsReply: z
        .boolean()
        .describe(
          "True, the default, for a request, question, or delegated task: the recipient answers you and OpenBot sends its result back. False for information the recipient may act on but must not answer, such as a status update, a heads-up, or your own reply to a task. A false message ends the exchange.",
        )
        .optional(),
    },
  },
];

export const OPENBOT_DYNAMIC_TOOLS = {
  type: "namespace",
  name: "openbot",
  description:
    "Attach files to the current response, keep structured data in the shared SQLite database, and work with persistent OpenBot teammates.",
  tools: OPENBOT_TOOL_DEFINITIONS.map((definition) => ({
    type: "function" as const,
    name: definition.name,
    description: definition.description,
    inputSchema: z.toJSONSchema(z.strictObject(definition.shape), { target: "draft-7" }),
  })),
} as const;
