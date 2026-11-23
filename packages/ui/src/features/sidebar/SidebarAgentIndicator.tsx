import { Clock3, MessageCircleQuestionMark, MousePointer2, ShieldCheck, X } from "@openbot/ui";
import type { JSX } from "@solidjs/web";
import { createEffect, createMemo, createSignal, onSettled, Show, untrack } from "solid-js";
import type { AvatarMood } from "../../bloub-avatar";
import { TypingDots } from "../../components/TypingDots";
import type { AgentProfile } from "../../data";
import { observeOnScreen } from "../../on-screen";
import { useText } from "../../text";
import { prefersReducedMotion } from "../../utils";
import { AgentAvatar } from "../agents/AgentAvatar";
import { SidebarRowTooltip } from "./SidebarRowTooltip";
import { SIDEBAR_WAIT_ACTION, SIDEBAR_WAIT_HINT, SIDEBAR_WAIT_TITLE } from "./sidebar-filtering";
import type { SidebarAgentState, SidebarChannelWait, SidebarRoutinePhase, SidebarWaitReason } from "./sidebar-types";

const SIDEBAR_WAIT_TOOLTIP_OPEN_DELAY = 350;

type SidebarBadgePhase = "idle" | "in" | "bump" | "bump-b" | "out";

function isFeltBadge(state: SidebarAgentState | undefined): boolean {
  return state?.kind === "unread" || routinePhase(state) === "failed";
}

function entersWithMotion(state: SidebarAgentState): boolean {
  return state.kind === "responded" || state.kind === "waiting" || isFeltBadge(state);
}

function badgeKey(state: SidebarAgentState | undefined): string | undefined {
  return state?.kind === "routine" ? `routine-${state.phase}` : state?.kind;
}

type SidebarBadgeSnapshot = {
  state: SidebarAgentState;
  key: string | undefined;
  felt: boolean;
  enters: boolean;
  count: number | undefined;
};

function badgeSnapshot(state: SidebarAgentState | undefined): SidebarBadgeSnapshot | undefined {
  if (!state) return undefined;
  return {
    state,
    key: badgeKey(state),
    felt: isFeltBadge(state),
    enters: entersWithMotion(state),
    count: state.kind === "unread" ? state.count : undefined,
  };
}

const SIDEBAR_BADGE_RESIZE: KeyframeAnimationOptions = { duration: 280, easing: "cubic-bezier(0.22, 1, 0.36, 1)" };

interface BadgeResizeSteps {
  readFrom(): void;
  cancel(): void;
  readTo(): void;
  start(): void;
}

let queuedResizes: BadgeResizeSteps[] = [];

function queueBadgeResize(steps: BadgeResizeSteps): void {
  queuedResizes.push(steps);
  if (queuedResizes.length === 1) requestAnimationFrame(runBadgeResizes);
}

function runBadgeResizes(): void {
  const batch = queuedResizes;
  queuedResizes = [];
  for (const steps of batch) steps.readFrom();
  for (const steps of batch) steps.cancel();
  for (const steps of batch) steps.readTo();
  for (const steps of batch) steps.start();
}

export function SidebarAgentIndicator(props: { state: () => SidebarAgentState | undefined }) {
  const { t } = useText();
  const [gone, setGone] = createSignal<SidebarAgentState | undefined>();
  const [phase, setPhase] = createSignal<SidebarBadgePhase>("idle");
  const [previousCount, setPreviousCount] = createSignal<number | null>(null);
  const shown = createMemo<SidebarAgentState | undefined>((previous) => {
    const state = props.state();
    if (state) return state;
    return isFeltBadge(previous) && previous !== gone() && !prefersReducedMotion() ? previous : undefined;
  });
  const held = createMemo<SidebarAgentState | undefined>((previous) => shown() ?? previous);
  let leaving: SidebarBadgeSnapshot | undefined;
  let badge: HTMLSpanElement | undefined;
  let pillWidth: number | undefined;
  let resize: Animation | undefined;
  let measureRun = 0;
  let mounted = false;

  const stop = () => {
    if (leaving) setGone(leaving.state);
    leaving = undefined;
    setPreviousCount(null);
    setPhase("idle");
  };
  const measure = () => (badge?.isConnected ? Number.parseFloat(getComputedStyle(badge).width) : undefined);

  let resizeQueued = false;
  let measureNext = false;
  let animateNext = false;
  let fromWidth: number | undefined;
  const resizeSteps: BadgeResizeSteps = {
    readFrom: () => {
      fromWidth = resize?.playState === "running" ? measure() : pillWidth;
    },
    cancel: () => {
      measureRun++;
      resize?.cancel();
      resize = undefined;
    },
    readTo: () => {
      pillWidth = measureNext ? measure() : undefined;
    },
    start: () => {
      resizeQueued = false;
      if (measureNext && pillWidth === undefined) {
        const run = measureRun;
        requestAnimationFrame(() => {
          if (run === measureRun) pillWidth ??= measure();
        });
      }
      if (animateNext && badge && fromWidth !== undefined && pillWidth !== undefined && fromWidth !== pillWidth) {
        resize = badge.animate([{ width: `${fromWidth}px` }, { width: `${pillWidth}px` }], SIDEBAR_BADGE_RESIZE);
      }
    },
  };

  createEffect(
    () => badgeSnapshot(props.state()),
    (next, previous) => {
      const leavingBadge = leaving;
      const current = previous ?? leavingBadge;
      if (leavingBadge === undefined && current?.count !== undefined && current.count === next?.count) return;
      measureNext = next?.count !== undefined;
      animateNext = false;
      if (!resizeQueued) {
        resizeQueued = true;
        queueBadgeResize(resizeSteps);
      }
      if (!mounted) {
        mounted = true;
        return;
      }
      if (prefersReducedMotion()) {
        stop();
        return;
      }
      if (!next) {
        if (untrack(phase) === "out") return;
        if (current?.felt) {
          leaving = current;
          setPhase("out");
        } else stop();
        return;
      }
      leaving = undefined;
      if (current?.count !== undefined && next.count !== undefined && leavingBadge === undefined) {
        if (next.count > 0) {
          setPreviousCount(current.count);
          setPhase(untrack(phase) === "bump" ? "bump-b" : "bump");
        } else setPreviousCount(null);
        animateNext = true;
        return;
      }
      setPreviousCount(null);
      if (leavingBadge !== undefined || next.key !== current?.key) {
        setPhase(next.enters ? "in" : "idle");
      }
    },
  );

  const animationEnded = (event: AnimationEvent) => {
    if (event.target !== event.currentTarget) return;
    if (untrack(phase) === "out" && event.animationName !== "sidebar-felt-out") return;
    stop();
  };
  const animationCancelled = (event: AnimationEvent) => {
    if (event.target === event.currentTarget && badge?.getAnimations().length === 0) stop();
  };
  const count = () => {
    const state = shown();
    return state?.kind === "unread" ? state.count : 0;
  };
  const rollClass = (direction: "in" | "out") => {
    if (phase() === "bump") {
      return direction === "in" ? "agent-row-unread-count-roll-in" : "agent-row-unread-count-roll-out";
    }
    if (phase() === "bump-b") {
      return direction === "in" ? "agent-row-unread-count-roll-in-b" : "agent-row-unread-count-roll-out-b";
    }
    return direction === "out" ? "agent-row-unread-count-roll-gone" : undefined;
  };

  return (
    <Show when={shown()}>
      {(state) => {
        const current = () => held() ?? state();
        const [onScreen, setOnScreen] = createSignal(true);
        onSettled(() => (badge ? observeOnScreen(badge, setOnScreen) : undefined));
        return (
          <span
            ref={badge}
            class={[
              "agent-row-agent-status",
              `agent-row-agent-status-${current().kind}`,
              routinePhase(current()) ? `agent-row-agent-status-routine-${routinePhase(current())}` : "",
              {
                "agent-row-agent-status-entering": phase() === "in",
                "agent-row-agent-status-bumping": phase() === "bump",
                "agent-row-agent-status-bumping-b": phase() === "bump-b",
                "agent-row-agent-status-leaving": phase() === "out",
                "agent-row-agent-status-still": !onScreen(),
              },
            ]}
            aria-hidden="true"
            onAnimationEnd={animationEnded}
            onAnimationCancel={animationCancelled}
          >
            <Show when={current().kind === "working"}>
              <TypingDots class="agent-row-thinking-dots" />
            </Show>
            <Show
              when={
                routinePhase(current()) === "running" ||
                routinePhase(current()) === "queued" ||
                current().kind === "limited"
              }
            >
              <Clock3 aria-hidden="true" />
            </Show>
            <Show when={waitReason(current())}>{(reason) => <SidebarWaitIcon reason={reason()} />}</Show>
            <Show when={routinePhase(current()) === "failed"}>
              <X aria-hidden="true" />
            </Show>
            <Show when={current().kind === "responded"}>
              <svg viewBox="0 0 12 12">
                <title>{t("sidebar.state.responded")}</title>
                <path d="m3 6.2 1.8 1.8L9 3.8" />
              </svg>
            </Show>
            <Show when={current().kind === "unread"}>
              <Show when={previousCount()}>
                {(previous) => (
                  <span
                    class={["agent-row-unread-count agent-row-unread-count-old", rollClass("out")]}
                    onAnimationEnd={() => setPreviousCount(null)}
                  >
                    {previous()}
                  </span>
                )}
              </Show>
              <Show when={count() > 0}>
                <span class={["agent-row-unread-count", rollClass("in")]}>{count()}</span>
              </Show>
            </Show>
          </span>
        );
      }}
    </Show>
  );
}

function routinePhase(state: SidebarAgentState | undefined): SidebarRoutinePhase | undefined {
  return state?.kind === "routine" ? state.phase : undefined;
}

function waitReason(state: SidebarAgentState): SidebarWaitReason | undefined {
  return state.kind === "waiting" ? state.reason : undefined;
}

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

export function SidebarWaitChip(props: { reason: SidebarWaitReason }) {
  const { t } = useText();
  return (
    <span class="agent-row-wait-chip">
      <SidebarWaitIcon reason={props.reason} />
      <span class="agent-row-wait-chip-label">{t(SIDEBAR_WAIT_ACTION[props.reason])}</span>
    </span>
  );
}

export function SidebarWaitTooltip(props: {
  wait: SidebarChannelWait;
  menuOpen: boolean;
  name?: string | undefined;
  children: JSX.Element;
}) {
  const { t } = useText();
  return (
    <SidebarRowTooltip
      openDelay={SIDEBAR_WAIT_TOOLTIP_OPEN_DELAY}
      menuOpen={props.menuOpen}
      class="sidebar-wait-tooltip"
      content={
        <>
          <Show when={props.name}>
            {(name) => (
              <span class="sidebar-name-tooltip-name" dir="auto">
                {name()}
              </span>
            )}
          </Show>
          <span class="sidebar-wait-tooltip-title">
            <SidebarWaitIcon reason={props.wait.reason} />
            {t(SIDEBAR_WAIT_TITLE[props.wait.reason])}
          </span>
          <Show when={props.wait.detail}>
            {(detail) => <span class="sidebar-wait-tooltip-detail">{detail()}</span>}
          </Show>
          <span class="sidebar-wait-tooltip-hint">{t(SIDEBAR_WAIT_HINT[props.wait.reason])}</span>
        </>
      }
    >
      {props.children}
    </SidebarRowTooltip>
  );
}

export function SidebarPinnedAvatar(props: {
  agent: Pick<AgentProfile, "avatarSeed" | "avatarHue" | "avatarColor" | "avatarUrl">;
  mood: AvatarMood;
  agentState: () => SidebarAgentState | undefined;
}) {
  return (
    <span class="agent-row-avatar sidebar-pinned-avatar">
      <AgentAvatar agent={props.agent} motion="idle" mood={props.mood} workingFaces />
      <SidebarAgentIndicator state={props.agentState} />
    </span>
  );
}
