import { For } from "solid-js";
import { type PluginTag, pluginTagFilters, SITE_PLUGINS } from "../../lib/plugins";

export interface PluginTagFiltersProps {
  selected: () => readonly string[];
  onToggle: (label: string) => void;
  /** Turns every tag off at once, which is what `All` does. */
  onClear: () => void;
}

/**
 * The row of tags over the grid, each one a switch rather than a link: a reader turns a tag on to
 * keep the listings that carry it, and on again to let the rest back. `All` leads the row and holds
 * the state the page opens in - nothing selected - so there is always one way back to the whole
 * catalog that does not ask a reader to remember what they pressed.
 *
 * Buttons with `aria-pressed`, not checkboxes and not links. Nothing is submitted and no address
 * changes, so a checkbox would promise a form that is not there and a link would promise a page that
 * is not there; a pressed button is what a switch that acts at once already means.
 *
 * The switches carry no motion of their own. A row a reader aims at has to hold still: anything that
 * lifts a switch, or moves the one beside it, moves the target while the pointer is travelling to it.
 * The colour change and the press are the whole of it, and they are the site's own.
 */
export function PluginTagFilters(props: PluginTagFiltersProps) {
  const filters = pluginTagFilters(SITE_PLUGINS);
  // Written out rather than passed a boolean: Solid gives an `aria-*` prop set to `true` an empty
  // string, which is not the value `aria-pressed` is read by and not the one the CSS matches.
  const isOn = (tag: PluginTag) => props.selected().includes(tag.label);

  return (
    /* A `fieldset` rather than a div with `role="group"`, which is the element that role names.
       It carries no form, and it does not need one: what it groups is a set of controls, and the
       legend is the only way to say what pressing one of them does. */
    <fieldset class="plugin-filters">
      <legend class="landing-visually-hidden">Filter plugins by tag</legend>
      {/* Pressed when nothing else is, rather than a switch that dims once it has been used: the row
          then always carries exactly one answer to "what am I looking at". */}
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
