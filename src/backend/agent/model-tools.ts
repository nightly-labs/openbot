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

function providerDefault(provider: AgentProvider, models: AgentModelOption[]): AgentModelOption | null {
  return (
    models.find((model) => model.provider === provider && model.id === defaultProviderModel(provider)) ??
    models.find((model) => model.provider === provider) ??
    null
  );
}

export type ProviderAccountRows = (provider: AgentProvider) => ProviderAccountStatus[] | undefined;

interface ProviderModels {
  provider: AgentProvider;
  defaultModel: string;
  models: ToolModel[];
  omittedModels?: number;
  accounts?: (Pick<ProviderAccountStatus, "id" | "label" | "state"> & { models?: ToolModel[] })[];
}

type ToolModel = Pick<AgentModelOption, "id" | "name"> &
  Partial<Pick<AgentModelOption, "defaultReasoningEffort" | "supportedReasoningEfforts">>;

function toolModel(model: AgentModelOption): ToolModel {
  return {
    id: model.id,
    name: model.name,
    ...(model.reasoningEffortConfigurable === false
      ? {}
      : {
          defaultReasoningEffort: model.defaultReasoningEffort,
          supportedReasoningEfforts: model.supportedReasoningEfforts,
        }),
  };
}

export type ProviderStatusRow = Pick<AgentProviderStatus, "id" | "off" | "state" | "message" | "lastError">;

export function providerCanRun(provider: AgentProvider, statuses: readonly ProviderStatusRow[]): boolean {
  const row = statuses.find((candidate) => candidate.id === provider);
  if (!row || provider === "acp") return true;
  return !row.off && (row.state === "available" || row.state === "checking" || row.state === "not-started");
}

export function requireRunnableProvider(
  model: Pick<AgentModelOption, "provider" | "id">,
  statuses: readonly ProviderStatusRow[],
): void {
  if (providerCanRun(model.provider, statuses)) return;
  throw new AgentSettingsRefused(
    sourceText("error.agent.modelProviderNotConnected", { model: model.id, provider: providerLabel(model.provider) }),
  );
}

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

const NEEDS_USER_STATES: ReadonlySet<AgentProviderState> = new Set(["sign-in-required", "outdated", "error"]);
const FIX_IN = "Server settings > Providers";

function emptyCatalogMessage(provider: AgentProvider): string {
  if (provider === "muse")
    return "Muse is signed in, but Muse sent no models for this account. Muse may not be available in the country where this agent runs, or this account may have no access to Muse models. The provider settings cannot fix this. Choose a model from another provider.";
  return `${providerLabel(provider)} is ready, but it lists no models now. Choose a model from another provider.`;
}

const SHORT_LIST_LENGTH = 8;
const QUERY_RESULT_LIMIT = 20;

export interface ListModelsRequest {
  provider?: AgentProvider | undefined;
  query?: string | undefined;
  inUse?: readonly Pick<AgentModelChoice, "provider" | "model">[];
  customEndpoints?: readonly ListedCustomEndpoint[];
}

export interface ListedCustomEndpoint {
  id: string;
  name: string;
  provider: CustomProviderHarness;
  loading: boolean;
}

const CUSTOM_PROVIDER_SETTINGS = `${FIX_IN} > Custom provider`;

interface CustomEndpointModels {
  id: string;
  name: string;
  provider: CustomProviderHarness;
  models: string[];
  omittedModels?: number;
  message?: string;
}

function customEndpointModels(
  endpoints: readonly ListedCustomEndpoint[],
  models: readonly AgentModelOption[],
  statuses: readonly ProviderStatusRow[],
  words: readonly string[],
): CustomEndpointModels[] {
  return endpoints.flatMap((endpoint) => {
    const runner = providerLabel(endpoint.provider);
    const canRun = providerCanRun(endpoint.provider, statuses);
    const own = canRun
      ? models.filter((model) => model.provider === endpoint.provider && model.id.startsWith(`${endpoint.id}/`))
      : [];
    const matching = words.length > 0 ? own.filter((model) => matchesQuery(model, words)) : own;
    const listed = matching.slice(0, SHORT_LIST_LENGTH).map((model) => model.id);
    let message: string | undefined;
    if (!canRun) message = `${runner} runs this endpoint and cannot run now. The user fixes it in ${FIX_IN}.`;
    else if (endpoint.loading)
      message = `${runner} reads the last change of this endpoint after its current task stops.`;
    else if (own.length === 0)
      message = `${runner} lists no model of this endpoint. The user checks it in ${CUSTOM_PROVIDER_SETTINGS}.`;
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

function shortList(own: AgentModelOption[], pinned: ReadonlySet<string>): AgentModelOption[] {
  let room = SHORT_LIST_LENGTH - own.filter((model) => pinned.has(model.id)).length;
  return own.filter((model) => {
    if (pinned.has(model.id)) return true;
    room -= 1;
    return room >= 0;
  });
}

function matchesQuery(model: AgentModelOption, words: readonly string[]): boolean {
  const text = `${model.id} ${model.name}`.toLowerCase();
  return words.every((word) => text.includes(word));
}

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
    off?: true;
    message?: string;
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
    usageLimitReturn: agent.usageLimitReturn
      ? {
          ...choice(agent.usageLimitReturn),
          reasoningEffort: agent.usageLimitReturn.reasoningEffort,
          ...(agent.usageLimitReturn.cause === "provider-error" ? { cause: "provider-error" } : {}),
        }
      : null,
  };
}

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
    model.reasoningEffortConfigurable === false
      ? sourceText("error.agent.reasoningEffortNotConfigurable", { model: model.id })
      : sourceText("error.agent.reasoningEffortUnsupported", {
          model: model.id,
          effort,
          efforts: model.supportedReasoningEfforts.join(", "),
        }),
  );
}

export function agentReasoningEffort(
  agent: Pick<AgentSummary, "provider" | "model" | "reasoningEffort">,
  models: AgentModelOption[],
): { reasoningEffort?: AgentReasoningEffort } {
  const model = models.find((candidate) => candidate.provider === agent.provider && candidate.id === agent.model);
  return model?.reasoningEffortConfigurable === false ? {} : { reasoningEffort: agent.reasoningEffort };
}

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
