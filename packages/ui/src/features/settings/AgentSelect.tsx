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
  const [mount, setMount] = createSignal<HTMLElement | undefined>();
  let root: HTMLElement | undefined;
  return (
    <Select<{ id: string; name: string }>
      ref={(element: HTMLElement) => {
        root = element;
      }}
      onOpenChange={(open) => {
        if (open) setMount(root?.closest<HTMLElement>(".skills-marketplace") ?? undefined);
      }}
      class="skills-agent-select"
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
      <SelectTrigger size="sm" aria-label={t("settings.agentSelect.label")}>
        <SelectValue<{ id: string; name: string }>>{(state) => state.selectedOption()?.name}</SelectValue>
      </SelectTrigger>
      <SelectContent mount={mount()} />
    </Select>
  );
}
