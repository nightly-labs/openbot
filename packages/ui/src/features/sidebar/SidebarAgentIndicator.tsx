import { Clock3, MessageCircleQuestionMark, MousePointer2, ShieldCheck, Tooltip, X } from "@openbot/ui";
import type { JSX } from "@solidjs/web";
import { createEffect, createSignal, Show } from "solid-js";
import type { AvatarMood } from "../../bloub-avatar";
import { TypingDots } from "../../components/TypingDots";
import type { AgentProfile } from "../../data";
import { useText } from "../../text";
import { AgentAvatar } from "../agents/AgentAvatar";
import { SIDEBAR_WAIT_ACTION, SIDEBAR_WAIT_HINT, SIDEBAR_WAIT_TITLE } from "./sidebar-filtering";
import type { SidebarAgentState, SidebarChannelWait, SidebarRoutinePhase, SidebarWaitReason } from "./sidebar-types";

/** Long enough that moving the pointer down the list does not flash every waiting row's tooltip. */
const SIDEBAR_WAIT_TOOLTIP_OPEN_DELAY = 350;

export function SidebarAgentIndicator(props: { state: () => SidebarAgentState | undefined }) {
  const { t } = useText();
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
      if (nextKind !== previousKind)
        setEntering(nextKind === "responded" || nextKind === "unread" || nextKind === "waiting");
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
          <Show
            when={
              routinePhase(state()) === "running" || routinePhase(state()) === "queued" || state().kind === "limited"
            }
          >
            <Clock3 aria-hidden="true" />
          </Show>
          <Show when={waitReason(state())}>{(reason) => <SidebarWaitIcon reason={reason()} />}</Show>
          <Show when={routinePhase(state()) === "failed"}>
            <X aria-hidden="true" />
          </Show>
          <Show when={state().kind === "responded"}>
            <svg viewBox="0 0 12 12">
              <title>{t("sidebar.state.responded")}</title>
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

function waitReason(state: SidebarAgentState): SidebarWaitReason | undefined {
  return state.kind === "waiting" ? state.reason : undefined;
}

/** One icon per wait reason, shared by the badge, the action chip and the tooltip. */
export function SidebarWaitIcon(props: { reason: SidebarWaitReason }) {
  return (
    <>
      <Show when={props.reason === "question"}>
        <MessageCircleQuestionMark aria-hidden="true" />
      </Show>
      <Show when={props.reason === "approval"}>
        <ShieldCheck aria-hidden="true" />
      </Show>
      <Show when={props.reason === "takeover"}>
        <MousePointer2 aria-hidden="true" />
      </Show>
    </>
  );
}

/** The chip in the time slot of a waiting row: what the user does next. */
export function SidebarWaitChip(props: { reason: SidebarWaitReason }) {
  const { t } = useText();
  return (
    <span class="agent-row-wait-chip">
      <SidebarWaitIcon reason={props.reason} />
      <span class="agent-row-wait-chip-label">{t(SIDEBAR_WAIT_ACTION[props.reason])}</span>
    </span>
  );
}

/**
 * The tooltip of a row in "Needs you": what the chat waits for, the question or the command, and what
 * selecting the row does. It stays closed while the row's context menu is open.
 */
export function SidebarWaitTooltip(props: { wait: SidebarChannelWait; menuOpen: boolean; children: JSX.Element }) {
  const { t } = useText();
  const [open, setOpen] = createSignal(false);
  return (
    <Tooltip.Root
      open={open() && !props.menuOpen}
      onOpenChange={setOpen}
      placement="right"
      gutter={10}
      openDelay={SIDEBAR_WAIT_TOOLTIP_OPEN_DELAY}
      closeDelay={0}
      skipDelayDuration={300}
    >
      <Tooltip.Trigger as="div" class="sidebar-agent-tooltip-trigger">
        {props.children}
      </Tooltip.Trigger>
      <Tooltip.Portal>
        <Tooltip.Content class="sidebar-wait-tooltip">
          <span class="sidebar-wait-tooltip-title">
            <SidebarWaitIcon reason={props.wait.reason} />
            {t(SIDEBAR_WAIT_TITLE[props.wait.reason])}
          </span>
          <Show when={props.wait.detail}>
            {(detail) => <span class="sidebar-wait-tooltip-detail">{detail()}</span>}
          </Show>
          <span class="sidebar-wait-tooltip-hint">{t(SIDEBAR_WAIT_HINT[props.wait.reason])}</span>
        </Tooltip.Content>
      </Tooltip.Portal>
    </Tooltip.Root>
  );
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
