import { customAgentIdOfModel } from "@openbot/contracts/agent-providers";
import { developmentStartingModel } from "@openbot/contracts/development-defaults";
import type { AgentModelId, AgentModelOption, AgentProviderStatus, CreateAgentInput } from "@openbot/contracts/ipc";
import { defaultProviderModel, PICKER_PROVIDERS } from "@openbot/contracts/ipc";
import { sourceText } from "@openbot/i18n/source";
import type { AgentProvider } from "../agent-client";
import { DEFAULT_AGENT_PROVIDER } from "../agent-store";
import { providerCanRun } from "./model-tools";
import { providerLabel } from "./thread-items";

export interface ProviderPreference {
  provider: AgentProvider;
  model: AgentModelId | null;
}

export interface ModelChoice {
  provider: AgentProvider;
  model: AgentModelOption;
}

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

export function modelUnavailableError(
  model: string,
  provider: AgentProvider | undefined,
  models: readonly AgentModelOption[],
  providers: readonly AgentProviderStatus[],
): Error {
  if (provider === undefined) return new Error(sourceText("error.agent.modelUnavailable"));
  const customAgentId = provider === "acp" ? customAgentIdOfModel(model) : null;
  const name = customAgentId ?? providerLabel(provider);
  const row = providers.find((candidate) => candidate.id === provider);
  if (row?.state !== "available") {
    return new Error(sourceText("error.agent.modelProviderNotConnected", { model, provider: name }));
  }
  const listed = models.some(
    (candidate) =>
      candidate.provider === provider &&
      (customAgentId === null || customAgentIdOfModel(candidate.id) === customAgentId),
  );
  if (listed) return new Error(sourceText("error.agent.modelNotInProviderList", { model, provider: name }));
  return new Error(
    row.lastError
      ? sourceText("error.agent.modelListEmpty", { model, provider: name, detail: row.lastError })
      : sourceText("error.agent.modelListEmptyNoError", { model, provider: name }),
  );
}

export function creationModel(
  input: Pick<CreateAgentInput, "provider" | "model">,
  models: AgentModelOption[],
  providers: readonly AgentProviderStatus[] = [],
): ModelChoice | null {
  const { provider, model: requestedId } = input;
  if (provider === undefined && requestedId === undefined) return null;
  if (requestedId !== undefined) {
    const model = models.find(
      (candidate) => candidate.id === requestedId && (provider === undefined || candidate.provider === provider),
    );
    if (!model) throw modelUnavailableError(requestedId, provider, models, providers);
    if (provider !== undefined && model.provider !== provider) {
      throw new Error(sourceText("error.agent.modelProviderMismatch"));
    }
    return { provider: model.provider, model };
  }
  if (provider === undefined) return null;
  const model =
    models.find((candidate) => candidate.provider === provider && candidate.id === defaultProviderModel(provider)) ??
    models.find((candidate) => candidate.provider === provider) ??
    null;
  if (!model) throw new Error(sourceText("error.provider.noModelNamed", { provider: providerLabel(provider) }));
  return { provider, model };
}

export function developmentDefaultsApply(preference: ProviderPreference, developmentDefaults: boolean): boolean {
  return developmentDefaults && builtInDefault(preference);
}

function builtInDefault(preference: ProviderPreference): boolean {
  return preference.provider === DEFAULT_AGENT_PROVIDER && preference.model === null;
}

export function startingChoice(
  models: AgentModelOption[],
  preference: ProviderPreference,
  context: { developmentDefaults: boolean; providerAvailable: (provider: AgentProvider) => boolean },
): ModelChoice | null {
  const developmentStart = developmentDefaultsApply(preference, context.developmentDefaults);
  const development = developmentStartingModel({
    enabled: developmentStart,
    models,
    providerAvailable: context.providerAvailable,
  });
  if (development) return development;
  const others = PICKER_PROVIDERS.filter((provider) => provider !== preference.provider);
  for (const provider of [preference.provider, ...others]) {
    const chosen = provider === preference.provider && !developmentStart;
    if (!chosen && !context.providerAvailable(provider)) continue;
    const model = startingModel(provider, models, preference);
    if (model) return { provider, model };
  }
  return null;
}

export function workflowProvider(
  starting: AgentProvider,
  preference: ProviderPreference,
  providers: readonly AgentProviderStatus[],
  models: readonly AgentModelOption[],
): AgentProvider {
  if (starting !== DEFAULT_AGENT_PROVIDER || !builtInDefault(preference)) return starting;
  if (providerCanRun(starting, providers)) return starting;
  return (
    PICKER_PROVIDERS.find(
      (provider) =>
        providers.some((candidate) => candidate.id === provider && candidate.state === "available") &&
        models.some((model) => model.provider === provider),
    ) ?? starting
  );
}
