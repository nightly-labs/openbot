import type { CreateAgentInput } from "@openbot/contracts/ipc";
import { createAgentInitialMessage } from "@openbot/ui/features/agents/agent-initial-message";
import type { FirstAgentDraft } from "@openbot/ui/features/agents/FirstAgentSetup";

export type NewAgentDraft = Pick<FirstAgentDraft, "name" | "purpose" | "avatarSeed" | "avatarHue" | "avatarColor"> &
  Partial<Pick<FirstAgentDraft, "provider" | "model" | "reasoningEffort" | "providerAccountId">>;

export function newAgentInput(
  draft: NewAgentDraft,
  createModelSupported: boolean,
  welcomeSupported: boolean,
): CreateAgentInput {
  return {
    name: draft.name.trim(),
    description: draft.purpose.trim() || "General-purpose assistant",
    avatarSeed: draft.avatarSeed,
    avatarHue: draft.avatarHue,
    avatarColor: draft.avatarColor ?? null,
    ...(createModelSupported && draft.provider && draft.model
      ? {
          provider: draft.provider,
          model: draft.model,
          ...(draft.reasoningEffort ? { reasoningEffort: draft.reasoningEffort } : {}),
          ...(draft.providerAccountId ? { providerAccountId: draft.providerAccountId } : {}),
        }
      : {}),
    initialMessage: createAgentInitialMessage(draft, welcomeSupported),
  };
}
