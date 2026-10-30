import type { AgentProviderId } from "./agent-providers";
import type { AgentModelId, AgentReasoningEffort } from "./ipc-agent-identity";

/** One provider, model and effort a development build can start a new agent on. */
export interface DevelopmentDefault {
  provider: AgentProviderId;
  model: AgentModelId;
  reasoningEffort: AgentReasoningEffort;
}

/**
 * What a new agent starts on in a development build, in place of the built-in `codex` default, in
 * the order they are tried.
 *
 * A development build is the one place where the model a developer reads their own product on is a
 * choice rather than a user's, so it is named here once and read by the backend, the new-agent form
 * and `scripts/seed-dev-state.ts`: the seeded showcase agents and an agent created by hand have to
 * agree, or a dev profile shows two different answers to the same question.
 *
 * Claude Haiku first, for a signed-in Claude. OpenCode's free DeepSeek after it, and in place of
 * Codex: the free tier needs no key and no account, so a developer with no Claude sign-in still
 * gets an agent that answers.
 *
 * It is a default, never an override. A recorded preference -- the provider and model setup or
 * Settings wrote -- wins, because that one is the developer saying what they want.
 */
export const DEVELOPMENT_CLAUDE_DEFAULT: DevelopmentDefault = {
  provider: "claude",
  model: "claude-haiku-5-5",
  reasoningEffort: "medium",
};
export const DEVELOPMENT_FREE_DEFAULT: DevelopmentDefault = {
  provider: "opencode",
  model: "opencode/deepseek-v4.1-flash-free",
  reasoningEffort: "medium",
};
export const DEVELOPMENT_DEFAULTS: readonly DevelopmentDefault[] = [
  DEVELOPMENT_CLAUDE_DEFAULT,
  DEVELOPMENT_FREE_DEFAULT,
];

/** The fields of a catalog model that the choice reads: the backend's and the renderer's both have them. */
interface DevelopmentModelOption {
  provider: string;
  id: AgentModelId;
  defaultReasoningEffort: AgentReasoningEffort;
  supportedReasoningEfforts: readonly AgentReasoningEffort[];
}

/**
 * The first development default the live catalog can run, with its provider, or `null` to leave the built-in default
 * alone.
 *
 * Two conditions, because the catalog alone does not say a model can answer. Claude lists its
 * built-in models before its CLI answers, signed in or not, and a provider that is not installed,
 * current and signed in is a first turn that fails. A model that fails either test is not a default.
 *
 * The effort is the one asked for while the model supports it, and the model's own default
 * otherwise, so a catalog that reports a narrower set than expected downgrades the effort rather
 * than writing an effort the provider will reject.
 */
export function developmentStartingModel<Option extends DevelopmentModelOption>(input: {
  enabled: boolean;
  models: readonly Option[];
  providerAvailable: (provider: AgentProviderId) => boolean;
}): { provider: AgentProviderId; model: Option } | null {
  if (!input.enabled) return null;
  for (const candidate of DEVELOPMENT_DEFAULTS) {
    const listed = input.models.find((model) => model.provider === candidate.provider && model.id === candidate.model);
    if (!listed || !input.providerAvailable(candidate.provider)) continue;
    const model = listed.supportedReasoningEfforts.includes(candidate.reasoningEffort)
      ? { ...listed, defaultReasoningEffort: candidate.reasoningEffort }
      : listed;
    return { provider: candidate.provider, model };
  }
  return null;
}
