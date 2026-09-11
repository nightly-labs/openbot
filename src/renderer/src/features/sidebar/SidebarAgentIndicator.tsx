import { Show } from "solid-js";
import { TypingDots } from "../../components/TypingDots";
import type { AgentProfile } from "../../data";
import { AgentAvatar } from "../agents/AgentAvatar";
import type { SidebarAgentState } from "./sidebar-types";

export function SidebarAgentIndicator(props: { state: SidebarAgentState }) {
  const unreadCount = () => (props.state.kind === "unread" ? props.state.count : 0);
  return (
    <span class={`agent-row-agent-status agent-row-agent-status-${props.state.kind}`} aria-hidden="true">
      <Show when={props.state.kind === "working"}>
        <TypingDots class="agent-row-thinking-dots" />
      </Show>
      <Show when={props.state.kind === "responded"}>
        <svg viewBox="0 0 12 12">
          <title>Responded</title>
          <path d="m3 6.2 1.8 1.8L9 3.8" />
        </svg>
      </Show>
      <Show when={props.state.kind === "unread"}>
        <span>{unreadCount()}</span>
      </Show>
    </span>
  );
}

export function SidebarPinnedAvatar(props: { agent: AgentProfile; agentState: () => SidebarAgentState | undefined }) {
  return (
    <span class="agent-row-avatar sidebar-pinned-avatar">
      <AgentAvatar agent={props.agent} motion={props.agentState()?.kind === "working" ? "working" : "idle"} />
      <Show when={props.agentState()}>{(state) => <SidebarAgentIndicator state={state()} />}</Show>
    </span>
  );
}
