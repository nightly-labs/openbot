import { type AgentProviderId, OPENCODE_DEFAULT_FREE_MODEL } from "./agent-providers";
import type { AgentModelId, AgentReasoningEffort } from "./ipc-agent-identity";

export interface DevelopmentDefault {
  provider: AgentProviderId;
  model: AgentModelId;
  reasoningEffort: AgentReasoningEffort;
}

export const DEVELOPMENT_CLAUDE_DEFAULT: DevelopmentDefault = {
  provider: "claude",
  model: "claude-haiku-5-5",
  reasoningEffort: "medium",
};
export const DEVELOPMENT_FREE_DEFAULT: DevelopmentDefault = {
  provider: "opencode",
  model: OPENCODE_DEFAULT_FREE_MODEL,
  reasoningEffort: "medium",
};
export const DEVELOPMENT_DEFAULTS: readonly DevelopmentDefault[] = [
  DEVELOPMENT_CLAUDE_DEFAULT,
  DEVELOPMENT_FREE_DEFAULT,
];

interface DevelopmentModelOption {
  provider: string;
  id: AgentModelId;
  defaultReasoningEffort: AgentReasoningEffort;
  supportedReasoningEfforts: readonly AgentReasoningEffort[];
}

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
