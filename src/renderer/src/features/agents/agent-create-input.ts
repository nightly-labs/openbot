import type { CreateAgentInput } from "@openbot/contracts/ipc";
import type { FirstAgentDraft } from "@openbot/ui/features/agents/FirstAgentSetup";
import { createAgentInitialMessage } from "./agent-initial-message";

/** A new agent asked for from a short draft, such as the routine canvas's card. */
export type NewAgentDraft = Pick<FirstAgentDraft, "name" | "purpose" | "avatarSeed" | "avatarHue" | "avatarColor"> &
  Partial<Pick<FirstAgentDraft, "provider" | "model" | "reasoningEffort" | "providerAccountId">>;

/**
 * The creation request for a draft. A draft without a provider leaves the backend to pick its
 * starting default. The provider and model travel with the request: the backend applies them before
 * the initial message is queued, while a later provider change would be rejected as active work. A
 * remote host without `agent-create-model` drops the pair and starts its own default. The reasoning
 * level and the account travel only with the pair; without a level, the backend starts the model's
 * default level, and without an account, the provider's own sign-in.
 */
export function newAgentInput(draft: NewAgentDraft, createModelSupported: boolean): CreateAgentInput {
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
    initialMessage: createAgentInitialMessage(draft),
  };
}
