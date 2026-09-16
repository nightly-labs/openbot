import type { AgentModelId, AgentModelOption, AgentProviderId, AgentReasoningEffort } from "@openbot/contracts/ipc";

/**
 * What a new agent starts on in a development build, in place of the built-in `codex` default.
 *
 * A development build is the one place where the model a developer reads their own product on is a
 * choice rather than a user's, so it is named here once and read by both the app and
 * `scripts/seed-dev-state.ts`: the seeded showcase agents and an agent created by hand have to
 * agree, or a dev profile shows two different answers to the same question.
 *
 * It is a default, never an override. A recorded preference -- the provider and model setup or
 * Settings wrote -- wins, because that one is the developer saying what they want.
 */
export const DEVELOPMENT_DEFAULT_PROVIDER: AgentProviderId = "opencode";
export const DEVELOPMENT_DEFAULT_MODEL: AgentModelId = "opencode-go/muse-spark-1.3-contributor";
export const DEVELOPMENT_DEFAULT_REASONING_EFFORT: AgentReasoningEffort = "medium";

/**
 * The development default as a model of the live catalog, or `null` to leave the built-in default
 * alone.
 *
 * Two conditions, because the catalog alone does not say a model can answer. `opencode-go/` is the
 * paid tier: without an OpenCode Go key, and without the user's own OpenCode sign-in, the CLI lists
 * the free tier only -- but a CLI that lists the Go catalog from a sign-in OpenBot cannot see is
 * still one whose provider has to be installed, current and signed in before an agent reaches it.
 * A model that fails either test is not a default, it is a first turn that answers
 * "Invalid API key.".
 *
 * The effort is the one asked for while the model supports it, and the model's own default
 * otherwise, so a catalog that reports a narrower set than expected downgrades the effort rather
 * than writing an effort the provider will reject.
 */
export function developmentStartingModel(input: {
  enabled: boolean;
  models: readonly AgentModelOption[];
  providerAvailable: (provider: AgentProviderId) => boolean;
}): AgentModelOption | null {
  if (!input.enabled) return null;
  const listed = input.models.find(
    (model) => model.provider === DEVELOPMENT_DEFAULT_PROVIDER && model.id === DEVELOPMENT_DEFAULT_MODEL,
  );
  if (!listed || !input.providerAvailable(DEVELOPMENT_DEFAULT_PROVIDER)) return null;
  return listed.supportedReasoningEfforts.includes(DEVELOPMENT_DEFAULT_REASONING_EFFORT)
    ? { ...listed, defaultReasoningEffort: DEVELOPMENT_DEFAULT_REASONING_EFFORT }
    : listed;
}
