import type { CreateAgentInput } from "@openbot/contracts/ipc";
import type { FirstAgentDraft } from "@openbot/ui/features/agents/FirstAgentSetup";
import { createAgentInitialMessage } from "./agent-initial-message";

/** A new agent asked for from a short draft, such as the routine canvas's card. */
export type NewAgentDraft = Pick<FirstAgentDraft, "name" | "purpose" | "avatarSeed" | "avatarHue"> &
  Partial<Pick<FirstAgentDraft, "provider" | "model">>;

/**
 * The creation request for a draft. A draft without a provider leaves the backend to pick its
 * starting default. The provider and model travel with the request: the backend applies them before
 * the initial message is queued, while a later provider change would be rejected as active work. A
 * remote host without `agent-create-model` drops the pair and starts its own default.
 */
export function newAgentInput(draft: NewAgentDraft, createModelSupported: boolean): CreateAgentInput {
  return {
    name: draft.name.trim(),
    description: draft.purpose.trim() || "General-purpose assistant",
    avatarSeed: draft.avatarSeed,
    avatarHue: draft.avatarHue,
    ...(createModelSupported && draft.provider && draft.model ? { provider: draft.provider, model: draft.model } : {}),
    initialMessage: createAgentInitialMessage(draft),
  };
}
