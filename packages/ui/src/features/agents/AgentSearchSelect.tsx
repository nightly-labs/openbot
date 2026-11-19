import { buttonVariants, ChevronDown } from "@openbot/ui";
import { SwapLabel, type SwapMotion } from "@openbot/ui/components/SwapLabel";
import { AgentAvatar } from "@openbot/ui/features/agents/AgentAvatar";
import { useText } from "@openbot/ui/text";
import { For, untrack } from "solid-js";
import { AgentPicker, type AgentPickerAgent } from "./AgentPicker";

export type AgentSearchSelectAgent = AgentPickerAgent;

export const agentOf = <Agent extends AgentSearchSelectAgent>(agents: readonly Agent[], agentId: string) =>
  agents.find((agent) => agent.id === agentId);

const AGENT_SWAP: SwapMotion = {
  distance: 6,
  blur: 6,
  enter: { duration: 320, easing: "cubic-bezier(0.33, 1, 0.68, 1)" },
  leave: { duration: 180, easing: "ease" },
};

export function AgentSearchSelect(props: {
  agents: readonly AgentSearchSelectAgent[];
  agentId: string;
  label: string;
  variant?: "ghost" | "outline";
  class?: string;
  onChange: (agentId: string) => void;
}) {
  const { t } = useText();
  const agent = () => agentOf(props.agents, props.agentId);
  let shownId = untrack(() => props.agentId);
  return (
    <AgentPicker
      agents={props.agents}
      value={props.agentId}
      onChange={props.onChange}
      label={t("conversation.tasks.page.agents")}
      triggerLabel={props.label}
      triggerClass={[buttonVariants({ variant: props.variant ?? "ghost", size: "sm" }), "tasks-page-agent", props.class]
        .filter(Boolean)
        .join(" ")}
    >
      <For each={[props.agentId]} keyed={(id) => id}>
        {(id) => {
          const entering = untrack(id) !== shownId;
          shownId = untrack(id);
          return (
            <span class="tasks-page-agent-face" data-entering={entering ? "" : undefined}>
              <AgentAvatar agent={agentOf(props.agents, id())} class="tasks-page-avatar" />
            </span>
          );
        }}
      </For>
      <SwapLabel text={agent()?.name ?? props.agentId} motion={AGENT_SWAP} />
      <ChevronDown class="tasks-page-agent-chevron" aria-hidden="true" />
    </AgentPicker>
  );
}
