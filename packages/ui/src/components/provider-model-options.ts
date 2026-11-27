import type {
  AgentModelListing,
  AgentProviderId,
  AgentProviderStatus,
  AgentStatus,
  ClientAgentModelOption,
  CustomProviderHarness,
  CustomProviderSummary,
  ProviderRuntimeStatus,
} from "@openbot/contracts/ipc";
import {
  agentProviderName,
  CUSTOM_AGENT_DEFAULT_MODEL,
  DEFAULT_CUSTOM_PROVIDER_HARNESS,
  isAgentProvider,
  isFreeOpencodeModel,
  isFreeOpencodeModelName,
  isKnownAgentProvider,
} from "@openbot/contracts/ipc";
import type { AppTextKey, AppTranslate } from "@openbot/i18n";
import { currentText } from "../text";

const EFFORT_LABELS: Partial<Record<string, AppTextKey>> = {
  none: "provider.effort.none",
  minimal: "provider.effort.minimal",
  low: "provider.effort.low",
  medium: "provider.effort.medium",
  high: "provider.effort.high",
  xhigh: "provider.effort.xhigh",
  max: "provider.effort.max",
  ultra: "provider.effort.ultra",
};

export interface PickerModel {
  id: string;
  provider: AgentProviderId;
  name: string;
  service: string;
  free: boolean;
  variants: { id: string; name: string }[];
  listing?: AgentModelListing;
}

export interface PickerModelGroup {
  name: string;
  models: PickerModel[];
}

const KNOWN_PROVIDER_LABELS: Record<string, string> = {
  chatgpt: "ChatGPT",
  deepseek: "DeepSeek",
  devin: "Devin",
  gemini: "Gemini",
  github: "GitHub",
  "github-copilot": "GitHub Copilot",
  openai: "OpenAI",
};

function providerLabel(id: string): string {
  const lower = id.toLowerCase();
  const known = KNOWN_PROVIDER_LABELS[lower];
  if (known) return known;
  if (isAgentProvider(lower)) return agentProviderName(lower);
  return id
    .replace(/[-_\s]+(.)?/g, (_match, letter: string) => (letter ? ` ${letter.toUpperCase()}` : ""))
    .replace(/^./, (letter) => letter.toUpperCase());
}

function groupLabel(service: string): string {
  const separator = service.lastIndexOf("/");
  if (separator < 0) return service;
  return `${service.slice(0, separator)} · ${providerLabel(service.slice(separator + 1))}`;
}

function openRouterLab(id: string): string {
  return id.split("/", 1)[0] ?? "";
}

function openRouterLabNames(options: readonly ClientAgentModelOption[]): Map<string, string> {
  const names = new Map<string, string>();
  for (const model of options) {
    if (model.provider !== "openrouter") continue;
    const separator = model.name.indexOf(": ");
    const lab = openRouterLab(model.id);
    if (separator > 0 && !names.has(lab)) names.set(lab, model.name.slice(0, separator));
  }
  return names;
}

export function splitServiceName(provider: string, fullName: string): { service: string; name: string } {
  const separator = provider === "opencode" || provider === "acp" ? fullName.indexOf("/") : -1;
  return separator < 0
    ? { service: "", name: fullName }
    : { service: fullName.slice(0, separator), name: fullName.slice(separator + 1) };
}

function modelTier(model: PickerModel): 0 | 1 {
  return model.free ? 0 : 1;
}

export function pickerModels(
  options: ClientAgentModelOption[],
  endpoints: readonly CustomProviderSummary[] = [],
): PickerModel[] {
  const { t } = currentText();
  const byId = new Map(options.map((model) => [model.id, model]));
  const variants = new Map<string, { id: string; name: string }[]>();
  const variantIds = new Set<string>();
  for (const model of options) {
    if (model.provider !== "opencode") continue;
    const match = /^(.*)\/(none|minimal|low|medium|high|xhigh|max|ultra)$/.exec(model.id);
    const [, baseId, effort] = match ?? [];
    const base = baseId === undefined ? undefined : byId.get(baseId);
    if (!base || effort === undefined || model.name !== `${base.name} (${effort})`) continue;
    const label = EFFORT_LABELS[effort];
    const name = label ? t(label) : effort.charAt(0).toUpperCase() + effort.slice(1);
    variants.set(base.id, [...(variants.get(base.id) ?? []), { id: model.id, name }]);
    variantIds.add(model.id);
  }
  const labNames = openRouterLabNames(options);
  const piEndpointNames = new Map(
    endpoints
      .filter((endpoint) => (endpoint.harness ?? DEFAULT_CUSTOM_PROVIDER_HARNESS) === "pi")
      .map((endpoint) => [endpoint.id, endpoint.name]),
  );
  return options
    .filter((model) => !variantIds.has(model.id))
    .flatMap((model) => {
      if (!isKnownAgentProvider(model.provider)) return [];
      if (
        model.provider === "acp" &&
        model.id.endsWith(`/${CUSTOM_AGENT_DEFAULT_MODEL}`) &&
        !model.name.includes("/")
      ) {
        return {
          id: model.id,
          provider: model.provider,
          name: t("app.modelVariant.default"),
          service: model.name,
          free: false,
          variants: [],
        };
      }
      let { service, name } = splitServiceName(model.provider, model.name);
      if (model.provider === "acp") {
        const idSeparator = model.id.indexOf("/");
        const innerId = idSeparator < 0 ? "" : model.id.slice(idSeparator + 1);
        const providerEnd = innerId.indexOf("/");
        const provider = providerEnd < 0 ? "" : innerId.slice(0, providerEnd);
        if (provider) service = `${service}/${provider}`;
        const inner = name.indexOf("/");
        if (inner >= 0 && (!provider || name.slice(0, inner) === provider)) name = name.slice(inner + 1);
      }
      let piEndpointModel = false;
      if (model.provider === "pi") {
        const separator = model.id.indexOf("/");
        const endpoint = separator > 0 ? piEndpointNames.get(model.id.slice(0, separator)) : undefined;
        if (endpoint) {
          service = endpoint;
          piEndpointModel = true;
        }
      }
      if (model.provider === "openrouter") {
        const lab = openRouterLab(model.id);
        service = labNames.get(lab) ?? providerLabel(lab);
        if (name.startsWith(`${service}: `)) name = name.slice(service.length + 2);
      }
      if (model.provider === "hermes") {
        const provider = name.indexOf(" · ");
        if (provider > 0) {
          service = name.slice(0, provider);
          name = name.slice(provider + 3);
        }
      }
      name = name.replace(/^[\s:–—-]+/, "") || model.id;
      return {
        id: model.id,
        provider: model.provider,
        name,
        service,
        free:
          (model.provider === "opencode" && isFreeOpencodeModel(model.id, name)) ||
          (model.provider === "openrouter" && model.id.endsWith(":free")) ||
          (piEndpointModel && isFreeOpencodeModelName(name)),
        variants: variants.has(model.id)
          ? [{ id: model.id, name: t("app.modelVariant.default") }, ...(variants.get(model.id) ?? [])]
          : [],
        ...(model.listing ? { listing: model.listing } : {}),
      };
    });
}

export function groupPickerModels(models: PickerModel[], search: string): PickerModelGroup[] {
  const query = search.trim().toLowerCase();
  const groups = new Map<string, PickerModelGroup>();
  const tiers = new Map<string, number>();
  for (const model of models) {
    if (!`${model.service} ${model.name}`.toLowerCase().includes(query)) continue;
    const name = model.provider === "acp" ? groupLabel(model.service) : model.service;
    const group = groups.get(model.service) ?? { name, models: [] };
    group.models.push(model);
    groups.set(model.service, group);
    tiers.set(model.service, Math.min(tiers.get(model.service) ?? modelTier(model), modelTier(model)));
  }
  for (const group of groups.values()) group.models.sort((left, right) => modelTier(left) - modelTier(right));
  return [...groups.entries()]
    .sort(([left], [right]) => (tiers.get(left) ?? 0) - (tiers.get(right) ?? 0))
    .map(([, group]) => group);
}

export function customProviderIds(
  providers: readonly CustomProviderSummary[],
): ReadonlyMap<string, CustomProviderHarness> {
  return new Map(providers.map((provider) => [provider.id, provider.harness ?? DEFAULT_CUSTOM_PROVIDER_HARNESS]));
}

export function isCustomEndpointModel(
  provider: ClientAgentModelOption["provider"],
  modelId: string | null | undefined,
  customIds: ReadonlyMap<string, CustomProviderHarness>,
): boolean {
  const separator = modelId?.indexOf("/") ?? -1;
  return Boolean(modelId) && separator > 0 && customIds.get(modelId?.slice(0, separator) ?? "") === provider;
}

export function isCustomModel(
  model: ClientAgentModelOption,
  customIds: ReadonlyMap<string, CustomProviderHarness>,
): boolean {
  return model.provider === "acp" || isCustomEndpointModel(model.provider, model.id, customIds);
}

export function providerAvailability(
  status: AgentStatus,
  models: readonly ClientAgentModelOption[],
  provider: AgentProviderId,
  t: AppTranslate,
): AgentProviderStatus {
  const explicit = status.providers?.find((item) => item.id === provider);
  if (explicit) return explicit;
  if (status.phase === "starting" || status.phase === "restarting") {
    return { id: provider, state: "checking", version: null, message: null };
  }
  const available = models.some((model) => model.provider === provider);
  return {
    id: provider,
    state: available ? "available" : "error",
    version: null,
    message: available ? null : t("provider.picker.unavailable", { name: agentProviderName(provider) }),
  };
}

export function providerTurnedOff(status: AgentStatus, provider: AgentProviderId): boolean {
  return status.providers?.some((item) => item.id === provider && item.off) ?? false;
}

export function providerUsable(status: AgentProviderStatus, runtime?: ProviderRuntimeStatus): boolean {
  return (
    status.state === "available" ||
    status.state === "checking" ||
    status.connectionState === "connecting" ||
    runtime?.phase === "downloading" ||
    runtime?.phase === "finishing"
  );
}

export function providerOffersModels(
  status: AgentStatus,
  models: readonly ClientAgentModelOption[],
  provider: AgentProviderId,
  runtime?: ProviderRuntimeStatus,
): boolean {
  return (
    !providerTurnedOff(status, provider) &&
    providerUsable(providerAvailability(status, models, provider, currentText().t), runtime)
  );
}
