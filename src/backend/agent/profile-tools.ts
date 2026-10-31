import { INPUT_LIMITS } from "@openbot/contracts/input-limits";
import {
  AGENT_ACCESS_MODES,
  AGENT_BACKUP_MODEL_LIMIT,
  AGENT_PROVIDERS,
  AGENT_REASONING_EFFORTS,
  type AgentAccess,
  type AgentSummary,
  AVATAR_HUES,
  AVATAR_SEED_PATTERN,
  agentComputerUseEnabled,
  isAvatarHue,
  isProviderAccountId,
  type UpdateAgentInput,
  workspaceAccessEnforced,
} from "@openbot/contracts/ipc";
import { z } from "zod";

const profileFields = {
  name: z.string().trim().min(1).max(INPUT_LIMITS.agentName),
  title: z.string().max(INPUT_LIMITS.agentTitle),
  description: z
    .string()
    .max(INPUT_LIMITS.agentDescription)
    .describe(`A short summary of the agent's work, at most ${INPUT_LIMITS.agentDescription} characters.`),
  avatarSeed: z.string().regex(AVATAR_SEED_PATTERN, "Invalid avatar seed."),
  // A number schema, not z.literal: Gemini rejects a request whose tool schema has a non-string enum.
  avatarHue: z
    .number()
    .int()
    .refine(isAvatarHue, "Invalid avatar hue.")
    .nullable()
    .describe(`One of ${AVATAR_HUES.join(", ")}, or null for an automatic hue.`),
};

export const createAgentToolSchema = z
  .object({
    ...profileFields,
    title: profileFields.title.optional(),
    avatarSeed: profileFields.avatarSeed.optional(),
    avatarHue: profileFields.avatarHue.optional(),
    initialMessage: z.string().trim().min(1).max(INPUT_LIMITS.messageText),
    provider: z
      .enum(AGENT_PROVIDERS)
      .describe(
        "Provider for the new agent. Omit provider and model to give it your own provider and model. See list_models.",
      )
      .optional(),
    model: z
      .string()
      .trim()
      .min(1)
      .max(INPUT_LIMITS.modelName)
      .describe("Model id from list_models. Omit it with a provider to use that provider's default model.")
      .optional(),
    reasoningEffort: z
      .enum(AGENT_REASONING_EFFORTS)
      .describe(
        "Reasoning effort that the model supports, from list_models. Omit to use your own effort when the new agent gets your model, else the model's default.",
      )
      .optional(),
  })
  .strict();

export const listModelsToolSchema = z
  .object({
    provider: z.enum(AGENT_PROVIDERS).describe("Show only the models of this provider.").optional(),
    query: z
      .string()
      .trim()
      .min(1)
      .max(200)
      .describe("Words that a model id or name contains. Searches all models.")
      .optional(),
  })
  .strict();

const providerAccountId = z.string().refine(isProviderAccountId, "Use an account id from list_models.");

export const updateProfileToolSchema = z
  .object({
    agentId: z.string().trim().min(1).max(INPUT_LIMITS.identifier),
    name: profileFields.name.optional(),
    title: profileFields.title.optional(),
    description: profileFields.description.optional(),
    avatarSeed: profileFields.avatarSeed.optional(),
    avatarHue: profileFields.avatarHue.optional(),
    avatarPath: z
      .string()
      .trim()
      .min(1)
      .max(INPUT_LIMITS.path)
      .describe(
        "Local PNG, JPEG, or WebP file, up to 512 KB. Resize or compress a copy with your available tools first if needed. Use an absolute path or a path relative to your workspace. Do not combine with avatarSeed or avatarHue.",
      )
      .optional(),
    provider: z
      .enum(AGENT_PROVIDERS)
      .describe("New provider for the agent. Pass a model with it, or omit the model to use the provider's default.")
      .optional(),
    model: z.string().trim().min(1).max(INPUT_LIMITS.modelName).describe("New model id from list_models.").optional(),
    reasoningEffort: z
      .enum(AGENT_REASONING_EFFORTS)
      .describe(
        "New reasoning effort that the model supports, from list_models. Omit to keep the current effort when the model supports it, else to use the model's default.",
      )
      .optional(),
    providerAccountId: providerAccountId
      .nullable()
      .describe(
        "Account id from list_models for the agent's provider, or null for the provider's own sign-in. A provider change without it uses the new provider's own sign-in. A provider, account or custom-agent change while the agent works is saved as pendingRuntime and applies before its next turn.",
      )
      .optional(),
    backupModels: z
      .object({
        automatic: z
          .boolean()
          .describe(
            "true: when a usage limit holds a message, or a provider error fails a turn before it did work, the agent moves at once to the first ready model in order. false: it asks in the chat first.",
          ),
        order: z
          .array(
            z
              .object({
                provider: z.enum(AGENT_PROVIDERS),
                model: z.string().trim().min(1).max(INPUT_LIMITS.modelName).describe("Model id from list_models."),
                providerAccountId: providerAccountId
                  .describe("Account id from list_models. Omit it for the provider's own sign-in.")
                  .optional(),
              })
              .strict(),
          )
          .max(AGENT_BACKUP_MODEL_LIMIT)
          .describe("The backup models to try, first to last. They use the agent's reasoning effort where they can."),
      })
      .strict()
      .nullable()
      .describe(
        "Replaces the agent's backup models. null removes them: the agent asks in the chat, with no saved order.",
      )
      .optional(),
    access: z
      .enum(AGENT_ACCESS_MODES)
      .describe("workspace limits the agent to writing in its workspace. Only the user can set full.")
      .optional(),
    computerUse: z
      .boolean()
      .describe("false turns Computer Use off for the agent. Only the user can turn it on.")
      .optional(),
    notifications: z.boolean().describe("Whether the user gets notifications for the agent.").optional(),
  })
  .strict();

/** One `update_agents` call reaches at most this many agents. */
const UPDATE_AGENTS_LIMIT = 100;

const updateProfileFields = updateProfileToolSchema.shape;

export const updateAgentsToolSchema = z
  .object({
    agentIds: z
      .array(updateProfileFields.agentId)
      .min(1)
      .max(UPDATE_AGENTS_LIMIT)
      .refine((ids) => new Set(ids).size === ids.length, "Pass each agent id once.")
      .describe("Stable ids from list_agents of the agents to change."),
    provider: updateProfileFields.provider,
    model: updateProfileFields.model,
    reasoningEffort: updateProfileFields.reasoningEffort,
    access: updateProfileFields.access,
    computerUse: updateProfileFields.computerUse,
    notifications: updateProfileFields.notifications,
  })
  .strict();

export const readAgentToolSchema = z
  .object({
    agentId: z
      .string()
      .trim()
      .min(1)
      .max(INPUT_LIMITS.identifier)
      .describe("Stable id from list_agents. Omit it to read your own agent.")
      .optional(),
  })
  .strict();

export const PROFILE_TOOL_NAMES: ReadonlySet<string> = new Set([
  "list_models",
  "read_agent",
  "create_agent",
  "update_profile",
  "update_agents",
]);

/**
 * Only the user can widen what an agent may do. An agent can restrict itself or a teammate, and a
 * request for the value the agent already has changes nothing.
 */
export function widensAgentSettings(
  target: AgentSummary,
  access: AgentAccess | undefined,
  computerUse: boolean | undefined,
): boolean {
  return (
    (access === "full" && workspaceAccessEnforced(target)) || (computerUse === true && !agentComputerUseEnabled(target))
  );
}

/** Only a restriction is written, so a user change between the check and this write is never undone. */
export function restrictionInput(
  access: AgentAccess | undefined,
  computerUse: boolean | undefined,
): Pick<UpdateAgentInput, "access" | "computerUse"> {
  return { ...(access === "workspace" ? { access } : {}), ...(computerUse === false ? { computerUse } : {}) };
}

/**
 * Describe a failed profile tool call. Schema failures omit submitted instructions and unknown field
 * names. A schema parsed with `reportInput` gives the checked value, so a trimmed field reports its
 * trimmed length.
 */
export function profileToolErrorMessage(error: unknown): string {
  if (!(error instanceof z.ZodError)) return error instanceof Error ? error.message : String(error);
  const details = error.issues.map((issue) => {
    if (issue.code === "unrecognized_keys") return "Remove unsupported profile fields.";
    const field = issue.path.join(".") || "arguments";
    if (issue.code === "too_big" && issue.origin === "string" && typeof issue.input === "string") {
      return `${field} must have at most ${issue.maximum} characters; received ${issue.input.length}. Shorten it and retry.`;
    }
    return `${field}: ${issue.message}`;
  });
  return `${details.join(" ")} Correct the arguments and retry.`;
}
