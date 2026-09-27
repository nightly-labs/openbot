import type { AgentModelOption, AgentReasoningEffort } from "@openbot/contracts/ipc";
import { AGENT_PROVIDERS, defaultProviderModel } from "@openbot/contracts/ipc";
import { sourceText } from "@openbot/i18n/source";
import type { AgentProvider } from "../agent-client";
import { providerLabel } from "./thread-items";

export interface ModelRequest {
  provider?: AgentProvider | undefined;
  model?: string | undefined;
  reasoningEffort?: AgentReasoningEffort | undefined;
}

/** The model a request that names only `provider` starts on: the same pick as `creationModel`. */
function providerDefault(provider: AgentProvider, models: AgentModelOption[]): AgentModelOption | null {
  return (
    models.find((model) => model.provider === provider && model.id === defaultProviderModel(provider)) ??
    models.find((model) => model.provider === provider) ??
    null
  );
}

interface ProviderModels {
  provider: AgentProvider;
  defaultModel: string;
  models: Pick<AgentModelOption, "id" | "name" | "defaultReasoningEffort" | "supportedReasoningEfforts">[];
}

/**
 * The `list_models` payload: each provider that lists a model, in `AGENT_PROVIDERS` order. It is the
 * list the model picker shows, so the same models `create_agent` accepts.
 */
export function listModelsPayload(
  models: AgentModelOption[],
  preferredProvider: AgentProvider,
  provider?: AgentProvider,
): { preferredProvider: AgentProvider; providers: ProviderModels[] } {
  const providers = AGENT_PROVIDERS.filter((id) => provider === undefined || id === provider).flatMap((id) => {
    const fallback = providerDefault(id, models);
    if (!fallback) return [];
    return [
      {
        provider: id,
        defaultModel: fallback.id,
        models: models
          .filter((model) => model.provider === id)
          .map((model) => ({
            id: model.id,
            name: model.name,
            defaultReasoningEffort: model.defaultReasoningEffort,
            supportedReasoningEfforts: model.supportedReasoningEfforts,
          })),
      },
    ];
  });
  return { preferredProvider, providers };
}

export function modelList(models: AgentModelOption[], provider?: AgentProvider): string {
  if (provider !== undefined) {
    return models
      .filter((model) => model.provider === provider)
      .map((model) => model.id)
      .join(", ");
  }
  return AGENT_PROVIDERS.flatMap((id) => {
    const ids = models.filter((model) => model.provider === id).map((model) => model.id);
    return ids.length > 0 ? [`${id}: ${ids.join(", ")}`] : [];
  }).join("; ");
}

/**
 * The model a `create_agent` call names, checked before the agent exists, with the same pick as
 * `creationModel`. Unlike the settings path, an unknown model or an effort the model does not
 * support is an error that names the valid values, so the calling agent can correct its request.
 * `null` means the request names no provider and no model.
 */
export function requestedToolModel(request: ModelRequest, models: AgentModelOption[]): AgentModelOption | null {
  const { provider, model } = request;
  if (provider !== undefined && !models.some((candidate) => candidate.provider === provider)) {
    throw new Error(sourceText("error.agent.providerNotListed", { provider: providerLabel(provider) }));
  }
  let chosen: AgentModelOption | null = null;
  if (model !== undefined) {
    chosen =
      models.find(
        (candidate) => candidate.id === model && (provider === undefined || candidate.provider === provider),
      ) ?? null;
    if (!chosen && models.length === 0) throw new Error(sourceText("error.agent.modelUnavailable"));
    if (!chosen)
      throw new Error(sourceText("error.agent.modelNotListed", { model, models: modelList(models, provider) }));
  } else if (provider !== undefined) {
    chosen = providerDefault(provider, models);
  }
  if (chosen && request.reasoningEffort !== undefined) requireReasoningEffort(chosen, request.reasoningEffort);
  return chosen;
}

export function requireReasoningEffort(model: AgentModelOption, effort: AgentReasoningEffort): void {
  if (model.supportedReasoningEfforts.includes(effort)) return;
  throw new Error(
    sourceText("error.agent.reasoningEffortUnsupported", {
      model: model.id,
      effort,
      efforts: model.supportedReasoningEfforts.join(", "),
    }),
  );
}
