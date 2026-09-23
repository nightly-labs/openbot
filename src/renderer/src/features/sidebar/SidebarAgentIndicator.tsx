import { createEffect, createSignal, Show } from "solid-js";
import type { AvatarMood } from "../../bloub-avatar";
import { TypingDots } from "../../components/TypingDots";
import { Clock3, TriangleAlert, X } from "../../components/ui";
import type { AgentProfile } from "../../data";
import { AgentAvatar } from "../agents/AgentAvatar";
import type { SidebarAgentState, SidebarRoutinePhase } from "./sidebar-types";

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
            routinePhase(state()) ? `agent-row-agent-status-routine-${routinePhase(state())}` : "",
            { "agent-row-agent-status-entering": entering() },
          ]}
          aria-hidden="true"
          onAnimationEnd={() => setEntering(false)}
        >
          <Show when={state().kind === "working"}>
            <TypingDots class="agent-row-thinking-dots" />
          </Show>
          <Show when={routinePhase(state()) === "running" || routinePhase(state()) === "queued"}>
            <Clock3 aria-hidden="true" />
          </Show>
          <Show when={routinePhase(state()) === "needs-attention"}>
            <TriangleAlert aria-hidden="true" />
          </Show>
          <Show when={routinePhase(state()) === "failed"}>
            <X aria-hidden="true" />
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

function routinePhase(state: SidebarAgentState): SidebarRoutinePhase | undefined {
  return state.kind === "routine" ? state.phase : undefined;
}

export function SidebarPinnedAvatar(props: {
  agent: AgentProfile;
  mood: AvatarMood;
  agentState: () => SidebarAgentState | undefined;
}) {
  return (
    <span class="agent-row-avatar sidebar-pinned-avatar">
      <AgentAvatar agent={props.agent} motion="idle" mood={props.mood} />
      <SidebarAgentIndicator state={props.agentState} />
    </span>
  );
}
