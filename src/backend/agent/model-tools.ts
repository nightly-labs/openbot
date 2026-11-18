import type {
  AgentBackupModels,
  AgentModelChoice,
  AgentModelOption,
  AgentProviderState,
  AgentProviderStatus,
  AgentReasoningEffort,
  AgentSummary,
  CustomProviderHarness,
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
import { isEncodedModelOf } from "../encoded-model-id";
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
  models: ToolModel[];
  /** The number of models of the provider that the list leaves out. */
  omittedModels?: number;
  accounts?: (Pick<ProviderAccountStatus, "id" | "label" | "state"> & { models?: ToolModel[] })[];
}

type ToolModel = Pick<AgentModelOption, "id" | "name"> &
  Partial<Pick<AgentModelOption, "defaultReasoningEffort" | "supportedReasoningEfforts">>;

function toolModel(model: AgentModelOption): ToolModel {
  return {
    id: model.id,
    name: model.name,
    // A model with no effort setting holds only a `medium` placeholder that never reaches the
    // provider, and an agent read it as a choice (#5215).
    ...(model.reasoningEffortConfigurable === false
      ? {}
      : {
          defaultReasoningEffort: model.defaultReasoningEffort,
          supportedReasoningEfforts: model.supportedReasoningEfforts,
        }),
  };
}

/** A provider row of the settings page, as `list_models` reads it. */
export type ProviderStatusRow = Pick<AgentProviderStatus, "id" | "off" | "state" | "message" | "lastError">;

/**
 * Whether an agent can run on the provider now or soon: it runs, OpenBot checks it, or it is not
 * started yet. `workflowProvider` uses the same rule. A row has its accounts only while it is available, so a
 * provider whose own sign-in is out cannot run. The catalogue keeps a built-in list of some
 * providers' models when they are signed out or missing, so a listed model is no proof (#7866). A
 * provider with no row has nothing against it. Custom agents share one row, and one that fails does
 * not stop the others.
 */
export function providerCanRun(provider: AgentProvider, statuses: readonly ProviderStatusRow[]): boolean {
  const row = statuses.find((candidate) => candidate.id === provider);
  if (!row || provider === "acp") return true;
  return !row.off && (row.state === "available" || row.state === "checking" || row.state === "not-started");
}

/** Refuses a model whose provider cannot run, so an agent does not get one that never answers (#7866). */
export function requireRunnableProvider(
  model: Pick<AgentModelOption, "provider" | "id">,
  statuses: readonly ProviderStatusRow[],
): void {
  if (providerCanRun(model.provider, statuses)) return;
  throw new AgentSettingsRefused(
    sourceText("error.agent.modelProviderNotConnected", { model: model.id, provider: providerLabel(model.provider) }),
  );
}

/**
 * Refuses a settings change that moves an agent to a model whose provider cannot run. A call that
 * names the model the agent has passes, so its other fields still apply.
 */
export function requireRunnableChange(
  target: Pick<AgentSummary, "provider" | "model">,
  runtime: Pick<UpdateAgentInput, "provider" | "model">,
  statuses: readonly ProviderStatusRow[],
): void {
  const { provider, model } = runtime;
  if (provider === undefined || model === undefined) return;
  if (provider === target.provider && model === target.model) return;
  requireRunnableProvider({ provider, id: model }, statuses);
}

/** The states in which a provider that is on lists no model until the user acts in its settings. */
const NEEDS_USER_STATES: ReadonlySet<AgentProviderState> = new Set(["sign-in-required", "outdated", "error"]);
/** Where the user fixes such a provider. It is in the payload, not in the tool description that each turn sends. */
const FIX_IN = "Server settings > Providers";

/**
 * Why a provider that is on and ready lists no model. Without it, the agent sent the user to the
 * provider settings, where the provider shows as ready, and the user had nothing to fix there (#10693).
 */
function emptyCatalogMessage(provider: AgentProvider): string {
  // Meta sends a signed-in Muse account an empty list where Muse is not offered (#5983).
  if (provider === "muse")
    return "Muse is signed in, but Muse sent no models for this account. Muse may not be available in the country where this agent runs, or this account may have no access to Muse models. The provider settings cannot fix this. Choose a model from another provider.";
  return `${providerLabel(provider)} is ready, but it lists no models now. Choose a model from another provider.`;
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
  /** The custom endpoints that the user saved, so an agent can find their models (#6471). */
  customEndpoints?: readonly ListedCustomEndpoint[];
}

/** A saved custom endpoint as `list_models` reads it: no base URL, key or headers. */
export interface ListedCustomEndpoint {
  id: string;
  name: string;
  /** The provider that runs the endpoint. Its models are listed under it as `<id>/<model>`. */
  provider: CustomProviderHarness;
  /** True while the provider has not read the last save: it reads it after its current task stops. */
  loading: boolean;
}

/** Where the user adds or changes a custom endpoint. An agent cannot do it. */
const CUSTOM_PROVIDER_SETTINGS = `${FIX_IN} > Custom provider`;

interface CustomEndpointModels {
  id: string;
  name: string;
  provider: CustomProviderHarness;
  /** The first model ids, as `update_profile` and `create_agent` take them. */
  models: string[];
  omittedModels?: number;
  /** Why the endpoint lists no model now. */
  message?: string;
}

/**
 * The saved endpoints with their first model ids. Agents did not find these models among the many
 * models of OpenCode, and told the user that OpenBot cannot use an OpenAI-compatible service (#6471).
 */
function customEndpointModels(
  endpoints: readonly ListedCustomEndpoint[],
  models: readonly AgentModelOption[],
  statuses: readonly ProviderStatusRow[],
  words: readonly string[],
): CustomEndpointModels[] {
  return endpoints.flatMap((endpoint) => {
    const runner = providerLabel(endpoint.provider);
    // A provider that cannot run lists no model, also when the catalogue keeps some (#7866).
    const canRun = providerCanRun(endpoint.provider, statuses);
    const own = canRun
      ? models.filter((model) => model.provider === endpoint.provider && model.id.startsWith(`${endpoint.id}/`))
      : [];
    // A query keeps only the matching models, as it does in `providers`.
    const matching = words.length > 0 ? own.filter((model) => matchesQuery(model, words)) : own;
    const listed = matching.slice(0, SHORT_LIST_LENGTH).map((model) => model.id);
    let message: string | undefined;
    if (!canRun) message = `${runner} runs this endpoint and cannot run now. The user fixes it in ${FIX_IN}.`;
    else if (endpoint.loading)
      message = `${runner} reads the last change of this endpoint after its current task stops.`;
    else if (own.length === 0)
      message = `${runner} lists no model of this endpoint. The user checks it in ${CUSTOM_PROVIDER_SETTINGS}.`;
    // An endpoint with models but no match for the query is left out, so the agent does not read it as empty.
    if (listed.length === 0 && message === undefined) return [];
    return {
      id: endpoint.id,
      name: endpoint.name,
      provider: endpoint.provider,
      models: listed,
      ...(matching.length > listed.length ? { omittedModels: matching.length - listed.length } : {}),
      ...(message === undefined ? {} : { message }),
    };
  });
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
 * A query searches all models. An account has its id, the name the user gave it and the models that
 * only it serves, never its email, its credentials or its folder. A provider that is on but lists no model until the user signs in,
 * updates or repairs it is in `unavailableProviders`, with the text of its settings row and where
 * that row is: without it, the agent could not tell the user why the provider is missing (#6053).
 * A provider that cannot run lists no model, also when the catalogue keeps its built-in models (#7866).
 * A provider that the request names is there in each state in which it has no model, also when it is
 * off or not downloaded: a CLI of the user's own on `PATH` does not make it available, and the agent
 * got an empty list with no reason (#7647). A list of all providers leaves those rows out. A named
 * provider that is ready but lists no model has a message that says so (#10693).
 * `customProviders` names each saved custom endpoint, its first model ids, and where the user changes
 * it, or why it lists no model (#6471).
 */
export function listModelsPayload(
  models: AgentModelOption[],
  preferredProvider: AgentProvider,
  accounts: ProviderAccountRows,
  statuses: readonly ProviderStatusRow[],
  request: ListModelsRequest = {},
): {
  preferredProvider: AgentProvider;
  providers: ProviderModels[];
  unavailableProviders?: {
    provider: AgentProvider;
    state: AgentProviderState;
    /** True when the user turned the provider off in its settings row. */
    off?: true;
    message?: string;
    /** Where the user fixes the provider; absent when the provider settings cannot fix it. */
    fixIn?: string;
  }[];
  customProviders?: { settings: string; endpoints: CustomEndpointModels[] };
} {
  const words = request.query?.toLowerCase().split(/\s+/).filter(Boolean) ?? [];
  let resultRoom = QUERY_RESULT_LIMIT;
  const providers = AGENT_PROVIDERS.filter((id) => request.provider === undefined || id === request.provider).flatMap(
    (id) => {
      const fallback = providerDefault(id, models);
      if (!fallback || !providerCanRun(id, statuses)) return [];
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
          models: listed.map(toolModel),
          ...(omitted > 0 ? { omittedModels: omitted } : {}),
          ...(rows
            ? {
                accounts: rows.map((account) => {
                  // The models that only this account serves, as the model picker shows them (#6109).
                  const extra = (account.models ?? []).filter(
                    (model) => words.length === 0 || matchesQuery(model, words),
                  );
                  return {
                    id: account.id,
                    label: account.label,
                    state: account.state,
                    ...(extra.length > 0 ? { models: extra.map(toolModel) } : {}),
                  };
                }),
              }
            : {}),
        },
      ];
    },
  );
  const unavailableProviders = statuses.flatMap((row) => {
    if (
      !(request.provider === undefined ? !row.off && NEEDS_USER_STATES.has(row.state) : row.id === request.provider) ||
      providers.some((listed) => listed.provider === row.id)
    )
      return [];
    // A ready row with a message holds a connection failure, and a `lastError` holds a model list
    // that failed. That text stays the reason, and the settings row shows it.
    const available = !row.off && row.state === "available";
    const ready = available && !row.message && !row.lastError;
    const message = ready ? emptyCatalogMessage(row.id) : row.message || (available ? row.lastError : null);
    return [
      {
        provider: row.id,
        state: row.state,
        ...(row.off ? { off: true as const } : {}),
        ...(message ? { message } : {}),
        ...(ready && row.id === "muse" ? {} : { fixIn: FIX_IN }),
      },
    ];
  });
  const endpoints = customEndpointModels(
    (request.customEndpoints ?? []).filter(
      (endpoint) => request.provider === undefined || endpoint.provider === request.provider,
    ),
    models,
    statuses,
    words,
  );
  return {
    preferredProvider,
    providers,
    ...(unavailableProviders.length > 0 ? { unavailableProviders } : {}),
    ...(endpoints.length > 0
      ? {
          customProviders: { settings: CUSTOM_PROVIDER_SETTINGS, endpoints },
        }
      : {}),
  };
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
 * of this computer, the ones the settings page offers. `modelsOf` gives the models of one account,
 * with the ones that only that account serves. As the settings page writes it, the stored
 * order omits the provider's own sign-in and the agent's own model, has each choice once, and an
 * order that asks first with no model is null.
 */
export function requestedBackupModels(
  request: AgentBackupModels | null,
  modelsOf: (choice: Pick<AgentModelChoice, "provider" | "providerAccountId">) => AgentModelOption[],
  accounts: ProviderAccountRows,
  own: AgentModelChoice,
): AgentBackupModels | null {
  if (request === null) return null;
  const order: AgentModelChoice[] = [];
  for (const { provider, model, providerAccountId } of request.order) {
    const accountId = providerAccountId ?? DEFAULT_PROVIDER_ACCOUNT_ID;
    const rows = accounts(provider);
    if (rows ? !rows.some((account) => account.id === accountId) : accountId !== DEFAULT_PROVIDER_ACCOUNT_ID) {
      throw new AgentSettingsRefused(
        sourceText("error.provider.accountNotFound", { provider: providerLabel(provider) }),
      );
    }
    // The listed id, also when the request names the model as its provider lists it.
    const listed = requestedToolModel({ provider, model }, modelsOf({ provider, providerAccountId }));
    const choice: AgentModelChoice = {
      provider,
      model: listed?.id ?? model,
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
    const own = (candidate: AgentModelOption) => provider === undefined || candidate.provider === provider;
    chosen =
      models.find((candidate) => candidate.id === model && own(candidate)) ??
      models.find((candidate) => isEncodedModelOf(candidate.id, model) && own(candidate)) ??
      null;
    if (!chosen && models.length === 0) throw new AgentSettingsRefused(sourceText("error.agent.modelUnavailable"));
    if (!chosen) {
      // Cursor puts the settings of a model in its value (`grok-4.7[context=256k,…]`) and lists only
      // some of them. The short list can leave them out, so name the listed values of that model (#4411).
      // `grok-4.7` and `grok-4.7[context=500k]` both name the model `grok-4.7`.
      const base = `${model.includes("[") ? model.slice(0, model.indexOf("[")) : model}[`;
      const first = models.find(
        (candidate) => candidate.id.startsWith(base) && (provider === undefined || candidate.provider === provider),
      );
      const variants = first
        ? models.filter((candidate) => candidate.provider === first.provider && candidate.id.startsWith(base))
        : [];
      throw new AgentSettingsRefused(
        first
          ? sourceText("error.agent.modelVariantNotListed", {
              model,
              provider: providerLabel(first.provider),
              models: variants.map((candidate) => candidate.id).join(", "),
            })
          : sourceText("error.agent.modelNotListed", { model, models: modelList(models, provider) }),
      );
    }
  } else if (provider !== undefined) {
    chosen = providerDefault(provider, models);
  }
  if (chosen && request.reasoningEffort !== undefined) requireReasoningEffort(chosen, request.reasoningEffort);
  return chosen;
}

export function requireReasoningEffort(model: AgentModelOption, effort: AgentReasoningEffort): void {
  if (model.supportedReasoningEfforts.includes(effort)) return;
  throw new AgentSettingsRefused(
    // A model with no effort setting lists only a `medium` placeholder, which `list_models` hides (#6372).
    model.reasoningEffortConfigurable === false
      ? sourceText("error.agent.reasoningEffortNotConfigurable", { model: model.id })
      : sourceText("error.agent.reasoningEffortUnsupported", {
          model: model.id,
          effort,
          efforts: model.supportedReasoningEfforts.join(", "),
        }),
  );
}

/**
 * The effort of an agent as the agent tools report it. A model with no effort setting gets none:
 * its stored effort never reaches the provider, and `list_models` shows no effort for it (#6372).
 */
export function agentReasoningEffort(
  agent: Pick<AgentSummary, "provider" | "model" | "reasoningEffort">,
  models: AgentModelOption[],
): { reasoningEffort?: AgentReasoningEffort } {
  const model = models.find((candidate) => candidate.provider === agent.provider && candidate.id === agent.model);
  return model?.reasoningEffortConfigurable === false ? {} : { reasoningEffort: agent.reasoningEffort };
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
