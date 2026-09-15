import {
  type AgentModelId,
  type AgentModelOption,
  type AgentProviderId,
  type AppSetupState,
  defaultProviderModel,
  PICKER_PROVIDERS,
} from "@openbot/contracts/ipc";

export interface CreationModelChoice {
  provider: AgentProviderId;
  model: AgentModelId;
}

/**
 * The provider and model a new-agent draft starts on: the saved setup choice when the live
 * catalog still lists it, else that provider's default when listed, else its first listed model,
 * else the first provider in picker order with any model. `null` while the catalog is empty.
 *
 * Seeding from the saved choice matters because the form always submits a pair: a hard-coded
 * default would bypass the backend's saved-provider default and fail outright after onboarding
 * with a provider the default does not cover.
 */
export function resolveCreationModel(
  setup: AppSetupState | null,
  modelOptions: AgentModelOption[],
): CreationModelChoice | null {
  const preferred = setup?.preferredProvider ?? null;
  const ordered: AgentProviderId[] = preferred
    ? [preferred, ...PICKER_PROVIDERS.filter((provider) => provider !== preferred)]
    : [...PICKER_PROVIDERS];
  for (const provider of ordered) {
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
