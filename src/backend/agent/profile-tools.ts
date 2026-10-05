import { INPUT_LIMITS } from "@openbot/contracts/input-limits";
import {
  AGENT_ACCESS_MODES,
  AGENT_PROVIDERS,
  AGENT_REASONING_EFFORTS,
  AVATAR_HUES,
  AVATAR_SEED_PATTERN,
} from "@openbot/contracts/ipc";
import { isDynamicRecord } from "@openbot/contracts/runtime-values";
import { z } from "zod";

const profileFields = {
  name: z.string().trim().min(1).max(INPUT_LIMITS.agentName),
  title: z.string().max(INPUT_LIMITS.agentTitle),
  description: z
    .string()
    .max(INPUT_LIMITS.agentDescription)
    .describe(
      `Standing instructions, at most ${INPUT_LIMITS.agentDescription} characters. Shorten longer instructions before calling this tool. An invalid request saves no profile changes.`,
    ),
  avatarSeed: z.string().regex(AVATAR_SEED_PATTERN, "Invalid avatar seed."),
  avatarHue: z.literal(AVATAR_HUES).nullable(),
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
  })
  .strict();

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
]);

/** Describe a failed profile tool call. Schema failures omit submitted instructions and unknown field names. */
export function profileToolErrorMessage(error: unknown, input: unknown): string {
  if (!(error instanceof z.ZodError)) return error instanceof Error ? error.message : String(error);
  const details = error.issues.map((issue) => {
    if (issue.code === "unrecognized_keys") return "Remove unsupported profile fields.";
    const field = issue.path.join(".") || "arguments";
    const value = isDynamicRecord(input) ? input[field] : undefined;
    if (issue.code === "too_big" && issue.origin === "string" && typeof value === "string") {
      return `${field} must have at most ${issue.maximum} characters; received ${value.length}. Shorten it and retry.`;
    }
    return `${field}: ${issue.message}`;
  });
  return `${details.join(" ")} No agent was created or changed. Correct the arguments and retry.`;
}
