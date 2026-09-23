import type { AgentModelId, AgentModelOption, CreateAgentInput } from "@openbot/contracts/ipc";
import { defaultProviderModel } from "@openbot/contracts/ipc";
import type { AgentProvider } from "../agent-client";
import { DEFAULT_AGENT_PROVIDER } from "../agent-store";
import { DEVELOPMENT_DEFAULT_PROVIDER, developmentStartingModel } from "./development-defaults";
import { providerLabel } from "./thread-items";

/** The provider and model setup or Settings recorded, `model` being `null` for the provider's default. */
export interface ProviderPreference {
  provider: AgentProvider;
  model: AgentModelId | null;
}

export interface ModelChoice {
  provider: AgentProvider;
  model: AgentModelOption;
}

/**
 * The model a new agent, or a profile draft with no agent, starts on for `provider`.
 *
 * Setup records a model beside the preferred provider, so that model comes first -- but only while
 * the CLI still lists it, because the list is the provider's answer and a saved id can name an
 * endpoint or a model that is gone. After it come the provider's own default and then whatever it
 * does list; `null` means it listed nothing at all.
 */
export function startingModel(
  provider: AgentProvider,
  models: AgentModelOption[],
  preference: ProviderPreference,
): AgentModelOption | null {
  const listed = (id: AgentModelId) => models.find((model) => model.provider === provider && model.id === id);
  const chosen = preference.model !== null && provider === preference.provider ? listed(preference.model) : null;
  return (
    chosen ?? listed(defaultProviderModel(provider)) ?? models.find((model) => model.provider === provider) ?? null
  );
}

/**
 * The provider and model a creation request names, resolved against what the CLIs list right now,
 * or `null` when the request names neither. A named model must be listed for the named provider;
 * a lone provider takes its default when listed, else whatever it lists first.
 */
export function creationModel(input: CreateAgentInput, models: AgentModelOption[]): ModelChoice | null {
  const { provider, model: requestedId } = input;
  if (provider === undefined && requestedId === undefined) return null;
  if (requestedId !== undefined) {
    const model = models.find(
      (candidate) => candidate.id === requestedId && (provider === undefined || candidate.provider === provider),
    );
    if (!model) throw new Error("The selected agent model is unavailable.");
    if (provider !== undefined && model.provider !== provider) {
      throw new Error("The selected model does not belong to that provider.");
    }
    return { provider: model.provider, model };
  }
  if (provider === undefined) return null;
  const model =
    models.find((candidate) => candidate.provider === provider && candidate.id === defaultProviderModel(provider)) ??
    models.find((candidate) => candidate.provider === provider) ??
    null;
  if (!model) throw new Error(`${providerLabel(provider)} has no available model.`);
  return { provider, model };
}

/**
 * The provider and model a new agent starts on, or `null` when the preferred provider lists
 * nothing at all.
 *
 * `startingModel` answers for one provider; this one chooses the provider too, which is what a
 * development default needs: the model it names belongs to OpenCode, and a preferred provider of
 * Codex would never list it.
 *
 * That default stands in for the built-in one and nothing else. A preferred provider that is not
 * the built-in one, or a model recorded beside it, is the developer's own choice and is left as
 * it is.
 */
export function startingChoice(
  models: AgentModelOption[],
  preference: ProviderPreference,
  development: { enabled: boolean; providerAvailable: (provider: AgentProvider) => boolean },
): ModelChoice | null {
  const developmentModel =
    preference.provider === DEFAULT_AGENT_PROVIDER && preference.model === null
      ? developmentStartingModel({
          enabled: development.enabled,
          models,
          providerAvailable: development.providerAvailable,
        })
      : null;
  if (developmentModel) return { provider: DEVELOPMENT_DEFAULT_PROVIDER, model: developmentModel };
  const model = startingModel(preference.provider, models, preference);
  return model ? { provider: preference.provider, model } : null;
}
