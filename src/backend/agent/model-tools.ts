import type {
  AgentBackupModels,
  AgentModelChoice,
  AgentModelOption,
  AgentReasoningEffort,
  AgentSummary,
  ProviderAccountStatus,
  UpdateAgentInput,
} from "@openbot/contracts/ipc";
import {
  AGENT_PROVIDERS,
  DEFAULT_PROVIDER_ACCOUNT_ID,
  defaultProviderModel,
  sameAgentModelChoice,
} from "@openbot/contracts/ipc";
import { sourceText } from "@openbot/i18n/source";
import type { AgentProvider } from "../agent-client";
import { AgentSettingsRefused } from "./agent-settings-refused";
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

/** The accounts of a provider that can hold more than one, its own sign-in first; undefined for the others. */
export type ProviderAccountRows = (provider: AgentProvider) => ProviderAccountStatus[] | undefined;

interface ProviderModels {
  provider: AgentProvider;
  defaultModel: string;
  models: Pick<AgentModelOption, "id" | "name" | "defaultReasoningEffort" | "supportedReasoningEfforts">[];
  /** The number of models of the provider that the list leaves out. */
  omittedModels?: number;
  accounts?: Pick<ProviderAccountStatus, "id" | "label" | "state">[];
}

/** The models of each provider that a list with no query shows, before the models in use. */
const SHORT_LIST_LENGTH = 8;
/** The models that a `list_models` query returns at most, over all providers. */
const QUERY_RESULT_LIMIT = 20;

export interface ListModelsRequest {
  provider?: AgentProvider | undefined;
  /** Words that the id or the name of each model must contain. */
  query?: string | undefined;
  /** The models that agents on this computer use now, as their model or as a backup model. */
  inUse?: readonly Pick<AgentModelChoice, "provider" | "model">[];
}

/**
 * The models of one provider in a short list, in catalog order: each model in `pinned`, then the first
 * models of the catalog up to `SHORT_LIST_LENGTH`.
 */
function shortList(own: AgentModelOption[], pinned: ReadonlySet<string>): AgentModelOption[] {
  let room = SHORT_LIST_LENGTH - own.filter((model) => pinned.has(model.id)).length;
  return own.filter((model) => {
    if (pinned.has(model.id)) return true;
    room -= 1;
    return room >= 0;
  });
}

/** True when the id or the name of the model contains each word of the query, in any case. */
function matchesQuery(model: AgentModelOption, words: readonly string[]): boolean {
  const text = `${model.id} ${model.name}`.toLowerCase();
  return words.every((word) => text.includes(word));
}

/**
 * The `list_models` payload: each provider that lists a model, in `AGENT_PROVIDERS` order. The models
 * are the ones the model picker shows, so the ones `create_agent` accepts. With no query, a provider
 * shows its default model, the models in use, and its first models; `omittedModels` counts the rest.
 * A query searches all models. An account has its id and the name the user gave it, never its email,
 * its credentials or its folder.
 */
export function listModelsPayload(
  models: AgentModelOption[],
  preferredProvider: AgentProvider,
  accounts: ProviderAccountRows,
  request: ListModelsRequest = {},
): { preferredProvider: AgentProvider; providers: ProviderModels[] } {
  const words = request.query?.toLowerCase().split(/\s+/).filter(Boolean) ?? [];
  let resultRoom = QUERY_RESULT_LIMIT;
  const providers = AGENT_PROVIDERS.filter((id) => request.provider === undefined || id === request.provider).flatMap(
    (id) => {
      const fallback = providerDefault(id, models);
      if (!fallback) return [];
      const own = models.filter((model) => model.provider === id);
      const candidates = words.length > 0 ? own.filter((model) => matchesQuery(model, words)) : own;
      let listed: AgentModelOption[];
      if (words.length > 0) {
        listed = candidates.slice(0, resultRoom);
        resultRoom -= listed.length;
      } else {
        const inUse = (request.inUse ?? []).filter((choice) => choice.provider === id).map((choice) => choice.model);
        listed = shortList(own, new Set([fallback.id, ...inUse]));
      }
      const omitted = candidates.length - listed.length;
      const rows = accounts(id);
      return [
        {
          provider: id,
          defaultModel: fallback.id,
          models: listed.map((model) => ({
            id: model.id,
            name: model.name,
            defaultReasoningEffort: model.defaultReasoningEffort,
            supportedReasoningEfforts: model.supportedReasoningEfforts,
          })),
          ...(omitted > 0 ? { omittedModels: omitted } : {}),
          ...(rows
            ? {
                accounts: rows.map((account) => ({
                  id: account.id,
                  label: account.label,
                  state: account.state,
                })),
              }
            : {}),
        },
      ];
    },
  );
  return { preferredProvider, providers };
}

/** The account and backup models of an agent as `read_agent` and `update_profile` report them. */
export function agentAccountSetup(agent: AgentSummary) {
  const choice = (model: AgentModelChoice) => ({
    provider: model.provider,
    model: model.model,
    providerAccountId: model.providerAccountId ?? DEFAULT_PROVIDER_ACCOUNT_ID,
  });
  return {
    providerAccountId: agent.providerAccountId ?? DEFAULT_PROVIDER_ACCOUNT_ID,
    backupModels: agent.backupModels
      ? { automatic: agent.backupModels.automatic, order: agent.backupModels.order.map(choice) }
      : null,
    // Set while a usage limit or a provider error keeps the agent on a backup model: the model it goes back to.
    usageLimitReturn: agent.usageLimitReturn
      ? {
          ...choice(agent.usageLimitReturn),
          reasoningEffort: agent.usageLimitReturn.reasoningEffort,
          ...(agent.usageLimitReturn.cause === "provider-error" ? { cause: "provider-error" } : {}),
        }
      : null,
  };
}

/**
 * The backup models that an `update_profile` request names, checked against the models and accounts
 * of this computer, the ones the settings page offers. As the settings page writes it, the stored
 * order omits the provider's own sign-in and the agent's own model, has each choice once, and an
 * order that asks first with no model is null.
 */
export function requestedBackupModels(
  request: AgentBackupModels | null,
  models: AgentModelOption[],
  accounts: ProviderAccountRows,
  own: AgentModelChoice,
): AgentBackupModels | null {
  if (request === null) return null;
  const order: AgentModelChoice[] = [];
  for (const { provider, model, providerAccountId } of request.order) {
    requestedToolModel({ provider, model }, models);
    const accountId = providerAccountId ?? DEFAULT_PROVIDER_ACCOUNT_ID;
    const rows = accounts(provider);
    if (rows ? !rows.some((account) => account.id === accountId) : accountId !== DEFAULT_PROVIDER_ACCOUNT_ID) {
      throw new AgentSettingsRefused(
        sourceText("error.provider.accountNotFound", { provider: providerLabel(provider) }),
      );
    }
    const choice: AgentModelChoice = {
      provider,
      model,
      ...(accountId === DEFAULT_PROVIDER_ACCOUNT_ID ? {} : { providerAccountId: accountId }),
    };
    if (![own, ...order].some((other) => sameAgentModelChoice(other, choice))) order.push(choice);
  }
  return request.automatic || order.length > 0 ? { automatic: request.automatic, order } : null;
}

/**
 * The model ids that an error names: for each provider, the short list that `list_models` shows with
 * no query, and "…" when the list leaves models out.
 */
export function modelList(models: AgentModelOption[], provider?: AgentProvider): string {
  const ids = (id: AgentProvider) => {
    const own = models.filter((model) => model.provider === id);
    const fallback = providerDefault(id, models);
    const listed = shortList(own, new Set(fallback ? [fallback.id] : [])).map((model) => model.id);
    return [...listed, ...(listed.length < own.length ? ["…"] : [])].join(", ");
  };
  if (provider !== undefined) return ids(provider);
  return AGENT_PROVIDERS.flatMap((id) =>
    models.some((model) => model.provider === id) ? [`${id}: ${ids(id)}`] : [],
  ).join("; ");
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
    throw new AgentSettingsRefused(sourceText("error.agent.providerNotListed", { provider: providerLabel(provider) }));
  }
  let chosen: AgentModelOption | null = null;
  if (model !== undefined) {
    chosen =
      models.find(
        (candidate) => candidate.id === model && (provider === undefined || candidate.provider === provider),
      ) ?? null;
    if (!chosen && models.length === 0) throw new AgentSettingsRefused(sourceText("error.agent.modelUnavailable"));
    if (!chosen)
      throw new AgentSettingsRefused(
        sourceText("error.agent.modelNotListed", { model, models: modelList(models, provider) }),
      );
  } else if (provider !== undefined) {
    chosen = providerDefault(provider, models);
  }
  if (chosen && request.reasoningEffort !== undefined) requireReasoningEffort(chosen, request.reasoningEffort);
  return chosen;
}

export function requireReasoningEffort(model: AgentModelOption, effort: AgentReasoningEffort): void {
  if (model.supportedReasoningEfforts.includes(effort)) return;
  throw new AgentSettingsRefused(
    sourceText("error.agent.reasoningEffortUnsupported", {
      model: model.id,
      effort,
      efforts: model.supportedReasoningEfforts.join(", "),
    }),
  );
}

/**
 * The provider, model and effort that a settings request names, checked against what the CLIs list
 * now. Like `create_agent`, a model or an effort that is not listed is an error that names the valid
 * values. A new model keeps the agent's effort when it supports it, else takes the model's default.
 */
export function requestedRuntime(
  target: Pick<AgentSummary, "provider" | "model" | "reasoningEffort">,
  request: ModelRequest,
  models: AgentModelOption[],
): Pick<UpdateAgentInput, "provider" | "model" | "reasoningEffort"> {
  if (request.provider === undefined && request.model === undefined && request.reasoningEffort === undefined) {
    return {};
  }
  const requested = requestedToolModel(request, models);
  if (requested) {
    const keptEffort = requested.supportedReasoningEfforts.includes(target.reasoningEffort)
      ? target.reasoningEffort
      : requested.defaultReasoningEffort;
    return {
      provider: requested.provider,
      model: requested.id,
      reasoningEffort: request.reasoningEffort ?? keptEffort,
    };
  }
  if (request.reasoningEffort === undefined) return {};
  const current = models.find((model) => model.provider === target.provider && model.id === target.model);
  if (!current) {
    throw new AgentSettingsRefused(
      sourceText("error.agent.modelNotListed", { model: target.model, models: modelList(models, target.provider) }),
    );
  }
  requireReasoningEffort(current, request.reasoningEffort);
  return { reasoningEffort: request.reasoningEffort };
}
