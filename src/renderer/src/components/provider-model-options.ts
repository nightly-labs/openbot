import type { AgentModelOption, CustomProviderSummary } from "@openbot/contracts/ipc";
import { isCustomProviderModelId, isFreeOpencodeModelName } from "@openbot/contracts/ipc";

export interface PickerModel {
  id: string;
  name: string;
  service: string;
  free: boolean;
  local: boolean;
  variants: { id: string; name: string }[];
}

export interface PickerModelGroup {
  name: string;
  models: PickerModel[];
}

/**
 * OpenCode names a custom provider by its config key, so a locally served model arrives as
 * `ollama/…` or `lmstudio/…` with no field saying the weights never leave the computer. These are
 * the runtime keys OpenCode documents for a local endpoint; anything else stays unlabelled rather
 * than guessing that a private host is local.
 */
const LOCAL_SERVICE_PATTERN = /^(ollama|lmstudio|lm-studio|llamacpp|llama-cpp|vllm|local)\//i;

/** Local first, then anything the provider names Free, then the rest. */
function modelTier(model: PickerModel): 0 | 1 | 2 {
  if (model.local) return 0;
  if (model.free) return 1;
  return 2;
}

/** OpenCode exposes reasoning variants as model IDs. Keep those IDs at the selection boundary. */
export function pickerModels(options: AgentModelOption[]): PickerModel[] {
  const byId = new Map(options.map((model) => [model.id, model]));
  const variants = new Map<string, { id: string; name: string }[]>();
  const variantIds = new Set<string>();
  for (const model of options) {
    if (model.provider !== "opencode") continue;
    const match = /^(.*)\/(none|minimal|low|medium|high|xhigh|max|ultra)$/.exec(model.id);
    const base = match && byId.get(match[1]);
    if (!base || model.name !== `${base.name} (${match[2]})`) continue;
    const effort = match[2];
    const name = effort === "xhigh" ? "Extra high" : effort[0].toUpperCase() + effort.slice(1);
    variants.set(base.id, [...(variants.get(base.id) ?? []), { id: model.id, name }]);
    variantIds.add(model.id);
  }
  return options
    .filter((model) => !variantIds.has(model.id))
    .map((model) => {
      const separator = model.provider === "opencode" ? model.name.indexOf("/") : -1;
      const name = (separator < 0 ? model.name : model.name.slice(separator + 1)).replace(/^[\s:–—-]+/, "") || model.id;
      return {
        id: model.id,
        name,
        service: separator < 0 ? "" : model.name.slice(0, separator),
        // Only label models explicitly named Free by the provider; unknown pricing stays unlabelled.
        // Shared with the catalog order, so the badge and the default agree on what is free.
        free: model.provider === "opencode" && isFreeOpencodeModelName(name),
        local: model.provider === "opencode" && LOCAL_SERVICE_PATTERN.test(model.id),
        variants: variants.has(model.id) ? [{ id: model.id, name: "Default" }, ...(variants.get(model.id) ?? [])] : [],
      };
    });
}

/**
 * One group per service, ordered by the best tier it holds. Keying the group by tier as well as by
 * service printed the same service twice - "OpenCode Zen" once for its free models and again for
 * its paid ones - so the tier now decides order and the row badge carries the pricing.
 */
export function groupPickerModels(models: PickerModel[], search: string): PickerModelGroup[] {
  const query = search.trim().toLowerCase();
  const groups = new Map<string, PickerModelGroup>();
  const tiers = new Map<string, number>();
  for (const model of models) {
    if (!`${model.service} ${model.name}`.toLowerCase().includes(query)) continue;
    const group = groups.get(model.service) ?? { name: model.service, models: [] };
    group.models.push(model);
    groups.set(model.service, group);
    tiers.set(model.service, Math.min(tiers.get(model.service) ?? modelTier(model), modelTier(model)));
  }
  for (const group of groups.values()) group.models.sort((left, right) => modelTier(left) - modelTier(right));
  return [...groups.values()].sort((left, right) => (tiers.get(left.name) ?? 0) - (tiers.get(right.name) ?? 0));
}

export function customProviderIds(providers: readonly CustomProviderSummary[]): ReadonlySet<string> {
  return new Set(providers.map((provider) => provider.id));
}

export function isCustomModel(model: AgentModelOption, customIds: ReadonlySet<string>): boolean {
  return model.provider === "opencode" && isCustomProviderModelId(model.id, customIds);
}
