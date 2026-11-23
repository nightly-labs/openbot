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

/**
 * The provider, and the model, that a new agent starts on when the catalog lists them: the saved
 * setup choice of this computer, or the choice of a joined server's provider step.
 */
export type CreationPreference = Pick<AppSetupState, "preferredProvider" | "preferredModel">;

export interface CreationModelChoice {
  provider: AgentProviderId;
  model: AgentModelId;
  /** Only for the development default, which has its own level. Else the model's default applies. */
  reasoningEffort?: AgentReasoningEffort | undefined;
}

/**
 * A development build's local server: which providers can run a turn now, read from the same
 * status rows the backend reads for its own development default.
 */
export interface DevelopmentCreation {
  providerAvailable: (provider: AgentProviderId) => boolean;
}

/**
 * The provider and model a new-agent draft starts on: the saved setup choice when the live
 * catalog still lists it, else that provider's default when listed, else its first listed model,
 * else the first provider in picker order with any model. `null` while the catalog is empty, or
 * when no listed provider can run: the draft then keeps what it has.
 *
 * Codex and Claude list built-in models before their CLI answers, signed in or not. So, as the
 * backend's `startingChoice` does, a provider other than the saved one is a start only while
 * `status` reports it available. A check in progress counts, so a re-check of a signed-in provider
 * does not move the draft; a provider with no status row counts by its models, as the picker does.
 *
 * Seeding from the saved choice matters because the form always submits a pair: a hard-coded
 * default would bypass the backend's saved-provider default and fail outright after onboarding
 * with a provider the default does not cover.
 *
 * With `development` and no saved choice beyond the built-in Codex, the form starts on the
 * backend's development default, and then only on a provider that can run, as `startingChoice`
 * does: the form submits its pair, so the backend default never applies to it.
 */
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
