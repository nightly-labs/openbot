import { SearchPicker } from "@openbot/ui/components/SearchPicker";
import type { AgentProfile } from "@openbot/ui/data";
import { useText } from "@openbot/ui/text";
import type { JSX } from "@solidjs/web";
import { Show } from "solid-js";
import { AgentAvatar } from "./AgentAvatar";

export type AgentPickerAgent = Pick<
  AgentProfile,
  "id" | "name" | "avatarSeed" | "avatarHue" | "avatarColor" | "avatarUrl"
>;

export interface AgentPickerProps {
  agents: readonly AgentPickerAgent[];
  value?: string | null | undefined;
  onChange: (agentId: string) => void;
  label: string;
  triggerClass: string;
  triggerLabel: string;
  count?: ((agentId: string) => number) | undefined;
  children: JSX.Element;
}

export function AgentPicker(props: AgentPickerProps) {
  const { t } = useText();
  const countOf = (agentId: string) => props.count?.(agentId) ?? 0;
  return (
    <SearchPicker<AgentPickerAgent>
      options={props.agents}
      optionKey={(agent) => agent.id}
      optionName={(agent) => agent.name}
      value={props.value}
      onChange={(agent) => props.onChange(agent.id)}
      label={props.label}
      searchLabel={t("conversation.tasks.page.searchAgents")}
      emptyText={(query) => t("conversation.tasks.page.noAgent", { query })}
      leading={(agent) => <AgentAvatar agent={agent} class="search-picker-avatar" />}
      trailing={(agent) => (
        <Show when={countOf(agent.id) > 0}>
          <span class="search-picker-count">{countOf(agent.id)}</span>
        </Show>
      )}
      triggerClass={props.triggerClass}
      triggerLabel={props.triggerLabel}
    >
      {props.children}
    </SearchPicker>
  );
}
