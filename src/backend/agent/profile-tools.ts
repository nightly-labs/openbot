import { INPUT_LIMITS } from "@openbot/contracts/input-limits";
import { AVATAR_HUES, isAvatarSeed } from "@openbot/contracts/ipc";
import { z } from "zod";

const profileFields = {
  name: z.string().trim().min(1).max(INPUT_LIMITS.agentName),
  title: z.string().max(INPUT_LIMITS.agentTitle),
  description: z.string().max(INPUT_LIMITS.agentDescription),
  avatarSeed: z.string().refine(isAvatarSeed, "Invalid avatar seed."),
  avatarHue: z.union(AVATAR_HUES.map((hue) => z.literal(hue))).nullable(),
};

export const createAgentToolSchema = z
  .object({
    ...profileFields,
    title: profileFields.title.optional(),
    avatarSeed: profileFields.avatarSeed.optional(),
    avatarHue: profileFields.avatarHue.optional(),
    initialMessage: z.string().trim().min(1).max(INPUT_LIMITS.messageText),
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
  })
  .strict();
