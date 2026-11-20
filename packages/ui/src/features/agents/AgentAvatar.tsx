import { BloubBot, type ExpressionId, POSES } from "@norbert_bodziony/bloub";
import { PlushBot, type PlushState, type PlushTransition } from "@norbert_bodziony/bloub/plush";
import { type AvatarMood, avatarMoodPresentation, type ShapeSafeStateId } from "@openbot/brand/bloub-avatar-motion";
import type { AgentStepActivity, AvatarColor, AvatarHue } from "@openbot/contracts/ipc";
import { prefersReducedMotion } from "@openbot/ui/utils";
import { createEffect, createMemo, createSignal, onSettled, Show } from "solid-js";
import { useAmbientMotion } from "../../ambient-motion";
import {
  AVATAR_EXPRESSIONS,
  type AvatarMotion,
  avatarStyleForSeed,
  bloubAvatarProfile,
  type SupportedAvatarSilhouetteId,
} from "../../bloub-avatar";
import type { AgentProfile } from "../../data";
import { documentFocused } from "../../document-focus";
import { documentStillFaces } from "../../document-rendering";
import { observeOnScreen } from "../../on-screen";

const AVATAR_FPS = 80;

interface PlushMood {
  state: PlushState;
  expression: ExpressionId | null;
  busy: boolean;
}

const PLUSH_MOODS: Readonly<Record<AvatarMood, PlushMood>> = {
  idle: { state: "idle", expression: null, busy: false },
  working: { state: "thinking", expression: "attentif", busy: true },
  connecting: { state: "thinking", expression: "attentif", busy: true },
  waiting: { state: "notify", expression: "curieux", busy: false },
  failed: { state: "failed", expression: null, busy: false },
  responded: { state: "idle", expression: "heureux", busy: false },
  asleep: { state: "asleep", expression: null, busy: false },
};

interface HoverFace {
  state: PlushState;
  expression: ExpressionId | null;
}

const HOVER_WINK: HoverFace = { state: "wink", expression: null };
const HOVER_FACES: readonly HoverFace[] = [
  HOVER_WINK,
  { state: "idle", expression: "surpris" },
  { state: "idle", expression: "excite" },
  { state: "idle", expression: "attentif" },
  { state: "idle", expression: "curieux" },
];

const WORKING_FACE_MIN_MS = 700;
const WORKING_FACE_MAX_MS = 3200;

const ACTIVITY_MOODS: Readonly<Record<AgentStepActivity, PlushMood>> = {
  searching: { state: "idle", expression: "curieux", busy: true },
  browsing: { state: "wide", expression: null, busy: true },
  reading: { state: "idle", expression: "attentif", busy: true },
  running: { state: "idle", expression: "excite", busy: true },
  editing: { state: "idle", expression: "fier", busy: true },
  delegating: { state: "wink", expression: null, busy: true },
  working: { state: "idle", expression: "attentif", busy: true },
  reviewing: PLUSH_MOODS.working,
};

const ACTIVITY_HOLD_MS = 1_400;

const PHOTO_BREATHE = "0.03";

const PLUSH_BODY_STYLE = { transform: "scale(1.15)" } as const;

function frozenPose(state: PlushState): number {
  return POSES[state === "wink" || state === "wide" || state === "notify" ? state : "idle"];
}

const STATIC_MOTIONS: ReadonlySet<AvatarMotion> = new Set(["hover", "idle"]);

const HOVER_GROUP = "[data-avatar-hover], button, a, [role='button'], [role='link'], [role='menuitem']";

interface AgentAvatarProps {
  agent?: Pick<AgentProfile, "avatarSeed" | "avatarHue" | "avatarColor" | "avatarUrl"> | undefined;
  seed?: string | undefined;
  hue?: AvatarHue | null;
  color?: AvatarColor | null | undefined;
  url?: string | null | undefined;
  motion?: AvatarMotion;
  mood?: AvatarMood;
  animationOffset?: number;
  shape?: SupportedAvatarSilhouetteId;
  expression?: ExpressionId;
  transition?: PlushTransition;
  followPointer?: boolean;
  workingFaces?: boolean;
  activity?: AgentStepActivity | null | undefined;
  eyeScale?: number;
  class?: string;
  style?: Record<string, string>;
}

export function AgentAvatar(props: AgentAvatarProps) {
  const seed = createMemo(() => props.seed ?? props.agent?.avatarSeed ?? "agent");
  const hue = createMemo(() => (props.hue !== undefined ? props.hue : (props.agent?.avatarHue ?? null)));
  const color = createMemo(() =>
    props.color !== undefined || props.hue !== undefined ? (props.color ?? null) : (props.agent?.avatarColor ?? null),
  );
  const motion = () => props.motion ?? "hover";
  const url = createMemo(() => (props.url !== undefined ? props.url : (props.agent?.avatarUrl ?? null)));
  const mood = (): AvatarMood => props.mood ?? "idle";
  const [imageFailed, setImageFailed] = createSignal(false);
  createEffect(
    () => url(),
    () => {
      setImageFailed(false);
    },
  );
  const className = () => `agent-avatar agent-avatar-motion-${motion()} ${props.class ?? ""}`;
  const ambientMotion = useAmbientMotion();
  const breathe = () => (PLUSH_MOODS[mood()].busy && ambientMotion() ? PHOTO_BREATHE : undefined);
  const photoStyle = (): Record<string, string> => {
    const amount = breathe();
    return amount ? { ...props.style, "--agent-avatar-breathe": amount } : { ...props.style };
  };
  return (
    <Show
      when={url() && !imageFailed()}
      fallback={
        <GeneratedAvatar
          seed={seed()}
          hue={hue()}
          color={color()}
          motion={motion()}
          mood={mood()}
          animationOffset={props.animationOffset}
          shape={props.shape}
          expression={props.expression}
          transition={props.transition ?? "pop"}
          followPointer={props.followPointer === true}
          workingFaces={props.workingFaces === true}
          activity={props.activity ?? null}
          eyeScale={props.eyeScale}
          class={className()}
          style={props.style}
        />
      }
    >
      <span
        class={`${className()} agent-avatar-custom`}
        style={photoStyle()}
        data-avatar="image"
        data-mood={mood()}
        data-breathe={breathe()}
        aria-hidden="true"
      >
        <AvatarImage url={url()} onFailed={() => setImageFailed(true)} />
      </span>
    </Show>
  );
}

function AvatarImage(props: { url: string | null; onFailed: () => void }) {
  return <img src={props.url ?? ""} alt="" draggable={false} onError={() => props.onFailed()} />;
}

function GeneratedAvatar(props: {
  seed: string;
  hue: AvatarHue | null;
  color: AvatarColor | null;
  motion: AvatarMotion;
  mood: AvatarMood;
  animationOffset?: number | undefined;
  shape?: SupportedAvatarSilhouetteId | undefined;
  expression?: ExpressionId | undefined;
  transition: PlushTransition;
  followPointer: boolean;
  workingFaces: boolean;
  activity: AgentStepActivity | null;
  eyeScale?: number | undefined;
  class: string;
  style?: Record<string, string> | undefined;
}) {
  let element: HTMLSpanElement | undefined;
  const [interacting, setInteracting] = createSignal(false);
  const [prefersReduced, setPrefersReduced] = createSignal(prefersReducedMotion());
  const [onScreen, setOnScreen] = createSignal(true);
  const reducedMotion = () => prefersReduced() || documentStillFaces();
  const ambientMotion = useAmbientMotion();
  const cyclesFaces = () => props.workingFaces && props.mood === "working";
  const [workingFace, setWorkingFace] = createSignal<ExpressionId>(nextWorkingFace(null));
  const requestedActivity = () =>
    props.mood === "working" && !props.workingFaces && !reducedMotion() ? props.activity : null;
  const shownActivity = createHeldActivity(requestedActivity, ACTIVITY_HOLD_MS);
  const activityMood = () => {
    const activity = shownActivity();
    return activity ? ACTIVITY_MOODS[activity] : null;
  };
  const plushMood = createMemo((): PlushMood => {
    if (cyclesFaces()) return { state: "idle", expression: reducedMotion() ? "attentif" : workingFace(), busy: true };
    return activityMood() ?? PLUSH_MOODS[props.mood];
  });
  const profile = createMemo(() => bloubAvatarProfile(props.seed, props.hue, props.color));
  const restingExpression = () => props.expression ?? profile().expression;
  const hovered = () =>
    interacting() &&
    !reducedMotion() &&
    props.mood === "idle" &&
    props.shape === undefined &&
    props.expression === undefined;
  const [hoverFace, setHoverFace] = createSignal<HoverFace | null>(null);
  const appearance = createMemo(
    () => {
      const hover = hovered() ? hoverFace() : null;
      return {
        shape: props.shape ?? profile().shape,
        color: profile().color,
        expression: plushMood().expression ?? hover?.expression ?? restingExpression(),
        state: hover?.state ?? plushMood().state,
      };
    },
    { equals: sameAppearance },
  );
  const flat = createMemo(() => avatarStyleForSeed(props.seed) === "flat");
  const flatAppearance = createMemo(
    () => {
      const presentation = avatarMoodPresentation(props.mood);
      const hover = hovered() ? hoverFace() : null;
      const stepMood = activityMood();
      const working = cyclesFaces() ? plushMood().expression : (stepMood?.expression ?? null);
      const motionState = stepMood?.state === "wide" || stepMood?.state === "wink" ? stepMood.state : null;
      const state: ShapeSafeStateId = hover?.state === "wink" ? "wink" : (motionState ?? presentation.state);
      return {
        shape: props.shape ?? profile().shape,
        color: profile().color,
        expression: working ?? presentation.expression ?? hover?.expression ?? restingExpression(),
        state,
      };
    },
    { equals: sameAppearance },
  );
  const flatBreathe = () => {
    const amount = flat() && !cyclesFaces() && ambientMotion() ? avatarMoodPresentation(props.mood).breathe : 0;
    return amount > 0 ? String(amount) : undefined;
  };
  const spanStyle = () => {
    const amount = flatBreathe();
    return amount ? { ...props.style, "--agent-avatar-breathe": amount } : props.style;
  };
  const animated = () =>
    props.followPointer ||
    (plushMood().busy && ambientMotion()) ||
    (!STATIC_MOTIONS.has(props.motion) && documentFocused()) ||
    interacting();

  createEffect(
    () => cyclesFaces() && !reducedMotion() && ambientMotion() && onScreen(),
    (cycling) => {
      if (!cycling) return;
      let timer = 0;
      const schedule = () => {
        timer = window.setTimeout(
          () => {
            setWorkingFace((current) => nextWorkingFace(current));
            schedule();
          },
          WORKING_FACE_MIN_MS + Math.random() * (WORKING_FACE_MAX_MS - WORKING_FACE_MIN_MS),
        );
      };
      schedule();
      return () => window.clearTimeout(timer);
    },
  );

  onSettled(() => {
    const media = window.matchMedia?.("(prefers-reduced-motion: reduce)");
    const syncReducedMotion = () => setPrefersReduced(media?.matches ?? false);
    syncReducedMotion();
    media?.addEventListener?.("change", syncReducedMotion);
    const stopObservingVisibility = element ? observeOnScreen(element, setOnScreen) : undefined;

    const group = element?.closest<HTMLElement>(`${HOVER_GROUP}, [tabindex]`);
    const interactionTarget = group?.matches(HOVER_GROUP) ? group : element;
    const startInteraction = () => {
      if (!interacting()) setHoverFace((previous) => randomHoverFace(previous, restingExpression()));
      setInteracting(true);
    };
    const stopInteraction = () => setInteracting(false);
    const startFocusInteraction = (event: FocusEvent) => {
      if (event.target instanceof Element && event.target.matches(":focus-visible")) startInteraction();
    };
    const stopFocusInteraction = (event: FocusEvent) => {
      if (!(event.relatedTarget instanceof Node) || !interactionTarget?.contains(event.relatedTarget)) {
        stopInteraction();
      }
    };
    interactionTarget?.addEventListener("pointerenter", startInteraction);
    interactionTarget?.addEventListener("pointerleave", stopInteraction);
    interactionTarget?.addEventListener("focusin", startFocusInteraction);
    interactionTarget?.addEventListener("focusout", stopFocusInteraction);

    return () => {
      stopObservingVisibility?.();
      media?.removeEventListener?.("change", syncReducedMotion);
      interactionTarget?.removeEventListener("pointerenter", startInteraction);
      interactionTarget?.removeEventListener("pointerleave", stopInteraction);
      interactionTarget?.removeEventListener("focusin", startFocusInteraction);
      interactionTarget?.removeEventListener("focusout", stopFocusInteraction);
    };
  });

  const avatar = () => (
    <PlushBot
      size={100}
      shape={appearance().shape}
      color={appearance().color}
      expression={appearance().expression}
      state={appearance().state}
      transition={props.transition}
      paused={!animated()}
      fps={AVATAR_FPS}
      autoPause
      initialPhase={props.animationOffset ?? avatarAnimationPhase(props.seed)}
      follow={props.followPointer}
      eyeScale={props.eyeScale ?? 1}
      ariaLabel=""
      class="bloub-avatar-svg"
      style={PLUSH_BODY_STYLE}
    />
  );

  const flatAvatar = () => (
    <BloubBot
      size={100}
      shape={flatAppearance().shape}
      color={flatAppearance().color}
      expression={flatAppearance().expression}
      state={flatAppearance().state}
      paused={!animated()}
      fps={AVATAR_FPS}
      autoPause
      initialPhase={props.animationOffset ?? avatarAnimationPhase(props.seed)}
      follow={props.followPointer}
      ariaLabel=""
      class="bloub-avatar-svg"
    />
  );

  const plushAvatar = () => (
    <Show
      when={!reducedMotion()}
      fallback={
        <Show when={appearance()} keyed>
          {(frozen) => (
            <PlushBot
              size={100}
              shape={frozen.shape}
              color={frozen.color}
              expression={frozen.expression}
              state={frozen.state}
              frozenAt={frozenPose(frozen.state)}
              eyeScale={props.eyeScale ?? 1}
              ariaLabel=""
              class="bloub-avatar-svg"
              style={PLUSH_BODY_STYLE}
            />
          )}
        </Show>
      }
    >
      {avatar()}
    </Show>
  );

  return (
    <span
      ref={element}
      class={`${props.class} agent-avatar-bloub`}
      style={spanStyle()}
      data-avatar="generated"
      data-mood={props.mood}
      data-breathe={flatBreathe()}
      aria-hidden="true"
    >
      <Show when={flat()} fallback={plushAvatar()}>
        <Show
          when={!reducedMotion()}
          fallback={
            <Show when={flatAppearance()} keyed>
              {(frozen) => (
                <BloubBot
                  size={100}
                  shape={frozen.shape}
                  color={frozen.color}
                  expression={frozen.expression}
                  state={frozen.state}
                  frozenAt={POSES[frozen.state]}
                  ariaLabel=""
                  class="bloub-avatar-svg"
                />
              )}
            </Show>
          }
        >
          {flatAvatar()}
        </Show>
      </Show>
    </span>
  );
}

function randomHoverFace(previous: HoverFace | null, resting: ExpressionId): HoverFace {
  const choices = HOVER_FACES.filter((face) => face !== previous && face.expression !== resting);
  return choices[Math.floor(Math.random() * choices.length)] ?? HOVER_WINK;
}

function nextWorkingFace(current: ExpressionId | null): ExpressionId {
  const choices = AVATAR_EXPRESSIONS.filter((face) => face !== current);
  return choices[Math.floor(Math.random() * choices.length)] ?? "attentif";
}

function createHeldActivity(value: () => AgentStepActivity | null, holdMs: number): () => AgentStepActivity | null {
  const [shown, setShown] = createSignal<AgentStepActivity | null>(null);
  let shownAt = 0;
  createEffect(value, (next) => {
    const wait = shownAt + holdMs - Date.now();
    const show = () => {
      shownAt = Date.now();
      setShown(next);
    };
    if (wait <= 0) {
      show();
      return;
    }
    const timer = window.setTimeout(show, wait);
    return () => window.clearTimeout(timer);
  });
  return shown;
}

function sameAppearance<T extends object>(a: T, b: T): boolean {
  for (const key in a) if (a[key] !== b[key]) return false;
  return true;
}

function avatarAnimationPhase(seed: string): number {
  let hash = 0x811c9dc5;
  for (let index = 0; index < seed.length; index += 1) {
    hash ^= seed.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return ((hash >>> 0) / 0x100000000) * 1.4;
}
