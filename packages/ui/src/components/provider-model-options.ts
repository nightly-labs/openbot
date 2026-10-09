import type { AgentModelOption, AgentProviderId, CustomProviderSummary } from "@openbot/contracts/ipc";
import {
  agentProviderName,
  CUSTOM_AGENT_DEFAULT_MODEL,
  isAgentProvider,
  isCustomProviderModelId,
  isFreeOpencodeModel,
} from "@openbot/contracts/ipc";
import type { AppTextKey } from "@openbot/i18n";
import { currentText } from "../text";

/** The efforts that have a name in the catalog. The other efforts show their id. */
const EFFORT_LABELS: Partial<Record<string, AppTextKey>> = {
  low: "provider.effort.low",
  medium: "provider.effort.medium",
  high: "provider.effort.high",
  xhigh: "provider.effort.xhigh",
  max: "provider.effort.max",
};

export interface PickerModel {
  id: string;
  /** The wire provider: the Custom tab holds both `opencode` endpoints and `acp` agents. */
  provider: AgentProviderId;
  name: string;
  service: string;
  free: boolean;
  variants: { id: string; name: string }[];
}

export interface PickerModelGroup {
  name: string;
  models: PickerModel[];
}

/**
 * How a provider id inside a custom agent reads in a group heading. An id that is also an OpenBot
 * provider takes its display name; a few other well-known ids keep their brand casing here; any
 * other id falls back to one capitalized word per `-`, `_` or space.
 */
const KNOWN_PROVIDER_LABELS: Record<string, string> = {
  chatgpt: "ChatGPT",
  deepseek: "DeepSeek",
  devin: "Devin",
  gemini: "Gemini",
  github: "GitHub",
  "github-copilot": "GitHub Copilot",
  openai: "OpenAI",
  openrouter: "OpenRouter",
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

/** `Agent/provider` group keys read `Agent · Provider`; a bare service stays as the agent named it. */
function groupLabel(service: string): string {
  const separator = service.lastIndexOf("/");
  if (separator < 0) return service;
  return `${service.slice(0, separator)} · ${providerLabel(service.slice(separator + 1))}`;
}

/** Free tier first; id says nothing about locality. */
function modelTier(model: PickerModel): 0 | 1 {
  return model.free ? 0 : 1;
}

/** OpenCode exposes reasoning variants as model IDs. Keep those IDs at the selection boundary. */
export function pickerModels(options: AgentModelOption[]): PickerModel[] {
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
  return options
    .filter((model) => !variantIds.has(model.id))
    .map((model) => {
      // A custom agent that lists no models has one, named for the agent alone.
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
      // OpenCode and custom agent models are named `<service>/<model>`; the service is the group.
      const separator = model.provider === "opencode" || model.provider === "acp" ? model.name.indexOf("/") : -1;
      let service = separator < 0 ? "" : model.name.slice(0, separator);
      let name = separator < 0 ? model.name : model.name.slice(separator + 1);
      // A custom agent can serve several providers. Its id holds them as `<agent>/<provider>/<model>`
      // even when its display name does not, so the provider segment of the id is the group.
      if (model.provider === "acp") {
        const idSeparator = model.id.indexOf("/");
        const innerId = idSeparator < 0 ? "" : model.id.slice(idSeparator + 1);
        const providerEnd = innerId.indexOf("/");
        const provider = providerEnd < 0 ? "" : innerId.slice(0, providerEnd);
        if (provider) service = `${service}/${provider}`;
        const inner = name.indexOf("/");
        if (inner >= 0 && (!provider || name.slice(0, inner) === provider)) name = name.slice(inner + 1);
      }
      name = name.replace(/^[\s:–—-]+/, "") || model.id;
      return {
        id: model.id,
        provider: model.provider,
        name,
        service,
        // Free-tier label only; shared with catalog order so badge and default agree.
        free: model.provider === "opencode" && isFreeOpencodeModel(model.id, name),
        variants: variants.has(model.id)
          ? [{ id: model.id, name: t("app.modelVariant.default") }, ...(variants.get(model.id) ?? [])]
          : [],
      };
    });
}

/** One group per service, ordered by best tier; tier orders, badge carries pricing. */
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
  // Tiers are keyed by service: an ACP group name is a label that differs from its key.
  return [...groups.entries()]
    .sort(([left], [right]) => (tiers.get(left) ?? 0) - (tiers.get(right) ?? 0))
    .map(([, group]) => group);
}

export function customProviderIds(providers: readonly CustomProviderSummary[]): ReadonlySet<string> {
  return new Set(providers.map((provider) => provider.id));
}

/** A model of the Custom tab: a custom endpoint's, which OpenCode serves, or a custom agent's. */
export function isCustomModel(model: AgentModelOption, customIds: ReadonlySet<string>): boolean {
  return model.provider === "acp" || (model.provider === "opencode" && isCustomProviderModelId(model.id, customIds));
}
