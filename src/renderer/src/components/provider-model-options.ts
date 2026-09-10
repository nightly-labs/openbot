import type { AgentModelOption } from "@openbot/contracts/ipc";
import { isFreeOpencodeModelName } from "@openbot/contracts/ipc";

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
        variants: variants.has(model.id) ? [{ id: model.id, name: "Default" }, ...(variants.get(model.id) ?? [])] : [],
      };
    });
}

export function groupPickerModels(models: PickerModel[], search: string): PickerModelGroup[] {
  const query = search.trim().toLowerCase();
  const groups = new Map<string, PickerModelGroup>();
  for (const model of [...models].sort((a, b) => Number(b.free) - Number(a.free))) {
    if (!`${model.service} ${model.name}`.toLowerCase().includes(query)) continue;
    const key = `${model.free}/${model.service}`;
    const group = groups.get(key) ?? { name: model.service, models: [] };
    group.models.push(model);
    groups.set(key, group);
  }
  return [...groups.values()];
}
