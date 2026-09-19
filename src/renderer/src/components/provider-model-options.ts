import type { AgentModelOption, CustomProviderSummary } from "@openbot/contracts/ipc";
import { isCustomProviderModelId, isFreeOpencodeModel } from "@openbot/contracts/ipc";

export interface PickerModel {
  id: string;
  name: string;
  service: string;
  free: boolean;
  variants: { id: string; name: string }[];
}

export interface PickerModelGroup {
  name: string;
  models: PickerModel[];
}

/** Free tier first; id says nothing about locality. */
function modelTier(model: PickerModel): 0 | 1 {
  return model.free ? 0 : 1;
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
        // Free-tier label only; shared with catalog order so badge and default agree.
        free: model.provider === "opencode" && isFreeOpencodeModel(model.id, name),
        variants: variants.has(model.id) ? [{ id: model.id, name: "Default" }, ...(variants.get(model.id) ?? [])] : [],
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
