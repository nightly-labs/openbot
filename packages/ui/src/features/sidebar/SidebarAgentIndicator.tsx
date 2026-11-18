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

/** Long enough that moving the pointer down the list does not flash every waiting row's tooltip. */
const SIDEBAR_WAIT_TOOLTIP_OPEN_DELAY = 350;

/**
 * How the badge moves now. `bump` and `bump-b` take turns, so a second change during a bounce
 * starts the bounce again. `out` keeps the last badge on screen while it leaves.
 */
type SidebarBadgePhase = "idle" | "in" | "bump" | "bump-b" | "out";

/** The badges that are felt: they bounce when they change and shrink away when they close. */
function isFeltBadge(state: SidebarAgentState | undefined): boolean {
  return state?.kind === "unread" || routinePhase(state) === "failed";
}

/** A badge enters when its kind, or the phase of a routine, changes to one of these. */
function entersWithMotion(state: SidebarAgentState): boolean {
  return state.kind === "responded" || state.kind === "waiting" || isFeltBadge(state);
}

function badgeKey(state: SidebarAgentState | undefined): string | undefined {
  return state?.kind === "routine" ? `routine-${state.phase}` : state?.kind;
}

/**
 * What the effect needs from a state. The state can be a store, and an effect callback does not
 * track, so the compute function reads the store and gives the callback these values.
 */
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

/** The pill grows or shrinks to the width of the new count, with the digit roll. */
const SIDEBAR_BADGE_RESIZE: KeyframeAnimationOptions = { duration: 280, easing: "cubic-bezier(0.22, 1, 0.36, 1)" };

/** The steps of one badge resize. `runBadgeResizes` does each step for all badges before the next step. */
interface BadgeResizeSteps {
  readFrom(): void;
  cancel(): void;
  readTo(): void;
  start(): void;
}

let queuedResizes: BadgeResizeSteps[] = [];

/**
 * A badge reads its width when its count changes, and its resize animation changes the style. When
 * many agents work, the counts change in many flushes in each frame, and a read after each flush made
 * the browser calculate the style of the page again each time. The badges therefore read and write
 * together, in steps, in the next frame: the reads use the style calculation that the frame does
 * anyway. The frame paints the new count and the start of its resize together.
 */
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

/**
 * The badge on a sidebar avatar. The badge on screen follows `state` and moves with each change:
 * a badge lands, an unread count bounces and rolls its digits when it changes, and a felt badge
 * shrinks away when it closes. The badge that leaves stays until its animation ends. With reduced
 * motion, the badge changes at once.
 */
export function SidebarAgentIndicator(props: { state: () => SidebarAgentState | undefined }) {
  const { t } = useText();
  /* The closed felt badge whose shrink animation has ended. */
  const [gone, setGone] = createSignal<SidebarAgentState | undefined>();
  const [phase, setPhase] = createSignal<SidebarBadgePhase>("idle");
  const [previousCount, setPreviousCount] = createSignal<number | null>(null);
  /* A felt badge stays on screen after its state closed, until it has shrunk away. The memo keeps
     it in the same flush, so the badge never leaves the page for a frame before it shrinks. */
  const shown = createMemo<SidebarAgentState | undefined>((previous) => {
    const state = props.state();
    if (state) return state;
    return isFeltBadge(previous) && previous !== gone() && !prefersReducedMotion() ? previous : undefined;
  });
  /* The last badge that showed, for the reads inside the badge. When `shown` closes, Solid can run
     the badge's effects once more before `Show` removes the badge. A read of `shown` there gave
     undefined and threw, which stopped all updates of the window. */
  const held = createMemo<SidebarAgentState | undefined>((previous) => shown() ?? previous);
  /* The badge that `shown` keeps while it shrinks away. */
  let leaving: SidebarBadgeSnapshot | undefined;
  let badge: HTMLSpanElement | undefined;
  /* The width of the pill after the last change. The page already shows the new count when the
     effect runs, so the old width comes from here. */
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
  /* The computed width is the layout width, which the bounce does not scale. While the pill
     resizes, it is the width on screen, so a new change continues from there. */
  const measure = () => (badge?.isConnected ? Number.parseFloat(getComputedStyle(badge).width) : undefined);

  /* What the queued resize does, as the last run of the effect before it sets. */
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
      /* A badge that has just appeared, or the first run, can come before the badge is in the
         document; the next frame measures it. */
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
      /* The host can send the same count again; that run must not stop the resize. */
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
        /* A count that goes to 0 is a read chat with a side thread still unread, not a new reply: the
           digits go and the pill narrows, with no bounce. */
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

  /* The animation of the badge itself has ended: the digits animate too, and their events bubble.
     A bump or an entrance can end in the same frame that the badge starts to shrink; only the end of
     the shrink removes the badge. */
  const animationEnded = (event: AnimationEvent) => {
    if (event.target !== event.currentTarget) return;
    if (untrack(phase) === "out" && event.animationName !== "sidebar-felt-out") return;
    stop();
  };
  /* A class change that starts the next animation cancels the one before; only a badge with no
     animation left, such as one in a collapsed section, settles. */
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
        /* The balls of a working badge hop only on screen. With 100 working agents, about 300 balls
           hopped, most of them in rows scrolled away, and each frame restyled all of them. */
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
 * selecting the row does. It stays closed while the row's context menu is open. The compact sidebar
 * shows only the avatar, so there `name` puts the chat's name first.
 */
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
