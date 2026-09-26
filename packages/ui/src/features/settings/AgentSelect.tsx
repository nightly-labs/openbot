/**
 * The agent an install goes to.
 *
 * The skill page and the plugin page both install into one agent, so they share this control rather
 * than each growing its own: the target is the same question, and the answer reads the same way.
 */

import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@openbot/ui";
import { createSignal } from "solid-js";
import { useText } from "../../text";

export function AgentSelect(props: {
  agents: Array<{ id: string; name: string }>;
  value: string;
  onChange: (value: string) => void;
}) {
  const { t } = useText();
  const selected = () => props.agents.find((agent) => agent.id === props.value) ?? null;
  /* The list belongs to the dialog, as in the settings modal: outside it the dialog hides it from
     assistive technology. */
  const [mount, setMount] = createSignal<HTMLElement | undefined>();
  let root: HTMLElement | undefined;
  return (
    <Select<{ id: string; name: string }>
      ref={(element: HTMLElement) => {
        root = element;
      }}
      // The dialog is in the tree only once the control is, so the list finds it as it opens.
      onOpenChange={(open) => {
        if (open) setMount(root?.closest<HTMLElement>(".skills-marketplace") ?? undefined);
      }}
      class="skills-agent-select"
      /* Kobalte prints the children of the value only once one is chosen, so the empty state is
         named here instead; without it the control reads as a blank pill. */
      placeholder={props.agents.length ? t("settings.agentSelect.placeholder") : t("settings.agentSelect.empty")}
      options={props.agents}
      value={selected()}
      optionValue="id"
      optionTextValue="name"
      disabled={!props.agents.length}
      onChange={(option) => {
        if (option) props.onChange(option.id);
      }}
      itemComponent={(item) => <SelectItem item={item.item}>{item.item.rawValue.name}</SelectItem>}
    >
      {/* The control sits beside the install button, which says what the target is for. */}
      <SelectTrigger size="sm" aria-label={t("settings.agentSelect.label")}>
        <SelectValue<{ id: string; name: string }>>{(state) => state.selectedOption()?.name}</SelectValue>
      </SelectTrigger>
      <SelectContent mount={mount()} />
    </Select>
  );
}
