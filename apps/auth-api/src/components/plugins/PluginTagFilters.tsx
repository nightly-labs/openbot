import { For } from "solid-js";
import { type PluginTag, pluginTagFilters, SITE_PLUGINS } from "../../lib/plugins";

export interface PluginTagFiltersProps {
  selected: () => readonly string[];
  onToggle: (label: string) => void;
  onClear: () => void;
}

export function PluginTagFilters(props: PluginTagFiltersProps) {
  const filters = pluginTagFilters(SITE_PLUGINS);
  const isOn = (tag: PluginTag) => props.selected().includes(tag.label);

  return (
    <fieldset class="plugin-filters">
      <legend class="landing-visually-hidden">Filter plugins by tag</legend>
      <button
        type="button"
        class="plugin-tag-button"
        aria-pressed={props.selected().length === 0 ? "true" : "false"}
        onClick={() => props.onClear()}
      >
        All
      </button>
      <For each={filters}>
        {(tag) => (
          <button
            type="button"
            class="plugin-tag-button"
            aria-pressed={isOn(tag) ? "true" : "false"}
            onClick={() => props.onToggle(tag.label)}
          >
            {tag.label}
          </button>
        )}
      </For>
    </fieldset>
  );
}
