import { createEffect, createSignal, Show } from "solid-js";
import { TypingDots } from "../../components/TypingDots";
import type { AgentProfile } from "../../data";
import { AgentAvatar } from "../agents/AgentAvatar";
import type { SidebarAgentState } from "./sidebar-types";

export function SidebarAgentIndicator(props: { state: () => SidebarAgentState | undefined }) {
  const [entering, setEntering] = createSignal(false);
  const unreadCount = () => {
    const state = props.state();
    return state?.kind === "unread" ? state.count : 0;
  };
  let mounted = false;

  createEffect(
    () => props.state()?.kind,
    (nextKind, previousKind) => {
      if (!mounted) {
        mounted = true;
        return;
      }
      if (nextKind !== previousKind) setEntering(nextKind === "responded" || nextKind === "unread");
    },
  );

  return (
    <Show when={props.state()}>
      {(state) => (
        <span
          class={[
            "agent-row-agent-status",
            `agent-row-agent-status-${state().kind}`,
            { "agent-row-agent-status-entering": entering() },
          ]}
          aria-hidden="true"
          onAnimationEnd={() => setEntering(false)}
        >
          <Show when={state().kind === "working"}>
            <TypingDots class="agent-row-thinking-dots" />
          </Show>
          <Show when={state().kind === "responded"}>
            <svg viewBox="0 0 12 12">
              <title>Responded</title>
              <path d="m3 6.2 1.8 1.8L9 3.8" />
            </svg>
          </Show>
          <Show when={state().kind === "unread"}>
            <span>{unreadCount()}</span>
          </Show>
        </span>
      )}
    </Show>
  );
}

export function SidebarPinnedAvatar(props: { agent: AgentProfile; agentState: () => SidebarAgentState | undefined }) {
  return (
    <span class="agent-row-avatar sidebar-pinned-avatar">
      <AgentAvatar agent={props.agent} motion={props.agentState()?.kind === "working" ? "working" : "idle"} />
      <SidebarAgentIndicator state={props.agentState} />
    </span>
  );
}
