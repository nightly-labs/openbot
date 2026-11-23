import { developmentStartingModel } from "@openbot/contracts/development-defaults";
import {
  type AgentModelId,
  type AgentProviderId,
  type AgentReasoningEffort,
  type AgentStatus,
  type AppSetupState,
  type ClientAgentModelOption,
  defaultProviderModel,
  PICKER_PROVIDERS,
} from "@openbot/contracts/ipc";

export type CreationPreference = Pick<AppSetupState, "preferredProvider" | "preferredModel">;

export interface CreationModelChoice {
  provider: AgentProviderId;
  model: AgentModelId;
  reasoningEffort?: AgentReasoningEffort | undefined;
}

export interface DevelopmentCreation {
  providerAvailable: (provider: AgentProviderId) => boolean;
}

export function resolveCreationModel(
  setup: CreationPreference | null,
  modelOptions: ClientAgentModelOption[],
  status: AgentStatus | null | undefined,
  development: DevelopmentCreation | null = null,
): CreationModelChoice | null {
  const preferred = setup?.preferredProvider ?? null;
  const developmentStart = development !== null && (preferred ?? "codex") === "codex" && !setup?.preferredModel;
  const start = developmentStartingModel({
    enabled: developmentStart,
    models: modelOptions,
    providerAvailable: (provider) => development?.providerAvailable(provider) ?? false,
  });
  if (start)
    return { provider: start.provider, model: start.model.id, reasoningEffort: start.model.defaultReasoningEffort };
  const ordered: AgentProviderId[] = preferred
    ? [preferred, ...PICKER_PROVIDERS.filter((provider) => provider !== preferred)]
    : [...PICKER_PROVIDERS];
  const runnable = (provider: AgentProviderId) => {
    const row = status?.providers?.find((item) => item.id === provider);
    return !row || row.state === "available" || row.state === "checking";
  };
  for (const provider of ordered) {
    if (developmentStart && !development?.providerAvailable(provider)) continue;
    if (provider !== preferred && !runnable(provider)) continue;
    const options = modelOptions.filter((option) => option.provider === provider);
    if (options.length === 0) continue;
    if (provider === preferred && setup?.preferredModel) {
      const kept = options.find((option) => option.id === setup.preferredModel);
      if (kept) return { provider, model: kept.id };
    }
    const fallback = options.find((option) => option.id === defaultProviderModel(provider)) ?? options[0];
    if (fallback) return { provider, model: fallback.id };
  }
  return null;
}
