import { INPUT_LIMITS } from "@openbot/contracts/input-limits";
import { AGENT_PROVIDERS, AGENT_REASONING_EFFORTS, AVATAR_HUES, AVATAR_SEED_PATTERN } from "@openbot/contracts/ipc";
import { z } from "zod";

const profileFields = {
  name: z.string().trim().min(1).max(INPUT_LIMITS.agentName),
  title: z.string().max(INPUT_LIMITS.agentTitle),
  description: z.string().max(INPUT_LIMITS.agentDescription),
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
      .describe("Provider for the new agent. Omit to use the user's default. See list_models.")
      .optional(),
    model: z
      .string()
      .trim()
      .min(1)
      .max(INPUT_LIMITS.modelName)
      .describe("Model id from list_models. Omit to use the provider's default model.")
      .optional(),
    reasoningEffort: z
      .enum(AGENT_REASONING_EFFORTS)
      .describe("Reasoning effort that the model supports, from list_models. Omit to use the model's default.")
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
  })
  .strict();
