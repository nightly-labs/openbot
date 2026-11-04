import { BloubBot, type ExpressionId, POSES } from "@norbert_bodziony/bloub";
import { PlushBot, type PlushState, type PlushTransition } from "@norbert_bodziony/bloub/plush";
import { type AvatarMood, avatarMoodPresentation, type ShapeSafeStateId } from "@openbot/brand/bloub-avatar-motion";
import type { AvatarColor, AvatarHue } from "@openbot/contracts/ipc";
import { prefersReducedMotion } from "@openbot/ui/utils";
import { createEffect, createMemo, createSignal, onSettled, Show } from "solid-js";
import {
  AVATAR_EXPRESSIONS,
  type AvatarMotion,
  avatarStyleForSeed,
  bloubAvatarProfile,
  type SupportedAvatarSilhouetteId,
} from "../../bloub-avatar";
import type { AgentProfile } from "../../data";

// Cap avatar animation at 30fps: uncapped bloub clocks measured 30% renderer / 24% GPU
// for two visible avatars. The shape is 24-40px, so the eye cannot see the difference.
const AVATAR_FPS = 30;

interface PlushMood {
  state: PlushState;
  /** `null` = the face the seed chose. `failed` and `asleep` set their own face and ignore it. */
  expression: ExpressionId | null;
  /** The mood keeps moving on its own, so the avatar runs without hover. */
  busy: boolean;
}

/*
 * How each mood shows on the plush. Only the eyes and the plush's own felt pieces move; the body, which
 * is the agent's identity, stays still and keeps its colour. No ring, glow or dimming is added round
 * it: a working agent looks up while three felt dots pulse beside it (or, with `workingFaces`, changes
 * faces with no dots), a waiting one shows a felt dot,
 * a failed turn lowers its eyes and shakes "no" once, and an asleep agent closes its eyes as z's rise.
 */
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
  /** `null` keeps the resting eyes: the state sets its own face. */
  expression: ExpressionId | null;
}

/**
 * What a resting agent does while it is pointed at or has keyboard focus. Each hover takes one of these
 * at random, and the eyes slide back on leave. They are friendly faces that differ clearly from most
 * resting eyes, also at sidebar size.
 */
const HOVER_WINK: HoverFace = { state: "wink", expression: null };
const HOVER_FACES: readonly HoverFace[] = [
  HOVER_WINK,
  { state: "idle", expression: "surpris" },
  { state: "idle", expression: "excite" },
  { state: "idle", expression: "attentif" },
  { state: "idle", expression: "curieux" },
];

/**
 * How long a working plush with no felt dots keeps one face. It takes every Bloub face, the silly ones
 * too, for a random time in this range, so two working agents never change together: the change, not
 * the face, says that the agent works.
 */
const WORKING_FACE_MIN_MS = 700;
const WORKING_FACE_MAX_MS = 3200;

/** A photo has no face to move, so a busy agent's photo breathes: a slow scale of the whole circle. */
const PHOTO_BREATHE = "0.03";

/** The plush body has the same radius as the flat body, but its soft, dark fur edge makes it look
 * smaller. This scale makes it look the same size. Each surface still sizes the box. */
const PLUSH_BODY_STYLE = { transform: "scale(1.15)" } as const;

/** The pose that a still plush shows. The plush plays `thinking`, `asleep` and `failed` on the
 * engine's `idle`. */
function frozenPose(state: PlushState): number {
  return POSES[state === "wink" || state === "wide" || state === "notify" ? state : "idle"];
}

// Motions that rest until pointer/focus arrives. The sidebar is not virtualized, so every
// row would otherwise animate on screen; idle-window profiles showed 83 recalcs/s from
// four resting avatars. A mood with its own motion keeps animating as the busy signal.
const STATIC_MOTIONS: ReadonlySet<AvatarMotion> = new Set(["hover", "idle"]);

// Hover group lookup: the first `[data-avatar-hover]`/control ancestor, since dialogs and
// scroll regions with `[tabindex]` are too wide to count as one.
const HOVER_GROUP = "[data-avatar-hover], button, a, [role='button'], [role='link'], [role='menuitem']";

interface AgentAvatarProps {
  agent?: Pick<AgentProfile, "avatarSeed" | "avatarHue" | "avatarColor" | "avatarUrl"> | undefined;
  seed?: string | undefined;
  hue?: AvatarHue | null;
  /** The exact colour, which wins over `hue`. With `hue` set, the agent's colour is not used. */
  color?: AvatarColor | null | undefined;
  url?: string | null | undefined;
  motion?: AvatarMotion;
  /** What the agent is doing. It chooses the face, never the silhouette. */
  mood?: AvatarMood;
  animationOffset?: number;
  shape?: SupportedAvatarSilhouetteId;
  /** The resting eyes, in place of the seed's. A mood with its own face still shows that face. */
  expression?: ExpressionId;
  /**
   * How a new shape or colour comes in. `cut` swaps it at once: use it where many avatars change
   * together, such as a picker grid, so that they do not all animate at the same time.
   */
  transition?: PlushTransition;
  /**
   * The eyes follow the pointer. The avatar then moves without hover, so use it only where few
   * avatars show. A photo avatar and reduced motion ignore it.
   */
  followPointer?: boolean;
  /**
   * A working plush changes to random faces at random times and plays no felt dots. Use it only where
   * a mark beside the avatar already shows the work, such as the sidebar badge.
   */
  workingFaces?: boolean;
  /**
   * Makes the eyes and the space between them larger. A small avatar, 24-40px, shows its face better
   * with larger eyes. 1 is the default size. A photo avatar ignores it.
   */
  eyeScale?: number;
  class?: string;
  style?: Record<string, string>;
}

export function AgentAvatar(props: AgentAvatarProps) {
  const seed = () => props.seed ?? props.agent?.avatarSeed ?? "agent";
  const hue = () => (props.hue !== undefined ? props.hue : (props.agent?.avatarHue ?? null));
  const color = () =>
    props.color !== undefined || props.hue !== undefined ? (props.color ?? null) : (props.agent?.avatarColor ?? null);
  const motion = () => props.motion ?? "hover";
  const url = () => (props.url !== undefined ? props.url : (props.agent?.avatarUrl ?? null));
  const mood = (): AvatarMood => props.mood ?? "idle";
  const [imageFailed, setImageFailed] = createSignal(false);
  createEffect(
    () => url(),
    () => {
      setImageFailed(false);
    },
  );
  const className = () => `agent-avatar agent-avatar-motion-${motion()} ${props.class ?? ""}`;
  // The custom property rides with the attribute rather than being set on every avatar: the
  // keyframe is an infinite animation, and a selector that matched all of them would start one
  // behind every resting row in the sidebar.
  const breathe = () => (PLUSH_MOODS[mood()].busy ? PHOTO_BREATHE : undefined);
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
  eyeScale?: number | undefined;
  class: string;
  style?: Record<string, string> | undefined;
}) {
  let element: HTMLSpanElement | undefined;
  const [interacting, setInteracting] = createSignal(false);
  const [reducedMotion, setReducedMotion] = createSignal(prefersReducedMotion());
  const cyclesFaces = () => props.workingFaces && props.mood === "working";
  const [workingFace, setWorkingFace] = createSignal<ExpressionId>(nextWorkingFace(null));
  const plushMood = createMemo(
    (): PlushMood =>
      cyclesFaces()
        ? { state: "idle", expression: reducedMotion() ? "attentif" : workingFace(), busy: true }
        : PLUSH_MOODS[props.mood],
  );
  const profile = createMemo(() => bloubAvatarProfile(props.seed, props.hue, props.color));
  const restingExpression = () => props.expression ?? profile().expression;
  // A preview of a chosen shape or eyes keeps the face it shows, so the choice stays visible on hover.
  const hovered = () =>
    interacting() &&
    !reducedMotion() &&
    props.mood === "idle" &&
    props.shape === undefined &&
    props.expression === undefined;
  const [hoverFace, setHoverFace] = createSignal<HoverFace | null>(null);
  // The silhouette and the colour are identity and come only from the seed. The mood may lend the
  // face an expression; when it does not, the seeded one is the resting face, or the hover face.
  const appearance = createMemo(() => {
    const hover = hovered() ? hoverFace() : null;
    return {
      shape: props.shape ?? profile().shape,
      color: profile().color,
      expression: plushMood().expression ?? hover?.expression ?? restingExpression(),
      state: hover?.state ?? plushMood().state,
    };
  });
  // A seed that `avatarSeedForFace` made for the flat style draws the Bloub that agents had before the
  // plush. It shows each mood with the flat faces, and a busy one breathes. It has no orbit rings, as
  // the plush has none.
  const flat = createMemo(() => avatarStyleForSeed(props.seed) === "flat");
  const flatAppearance = createMemo(() => {
    const presentation = avatarMoodPresentation(props.mood);
    const hover = hovered() ? hoverFace() : null;
    const working = cyclesFaces() ? plushMood().expression : null;
    const state: ShapeSafeStateId = hover?.state === "wink" ? "wink" : presentation.state;
    return {
      shape: props.shape ?? profile().shape,
      color: profile().color,
      expression: working ?? presentation.expression ?? hover?.expression ?? restingExpression(),
      state,
    };
  });
  const flatBreathe = () => {
    const amount = flat() && !cyclesFaces() ? avatarMoodPresentation(props.mood).breathe : 0;
    return amount > 0 ? String(amount) : undefined;
  };
  const spanStyle = () => {
    const amount = flatBreathe();
    return amount ? { ...props.style, "--agent-avatar-breathe": amount } : props.style;
  };
  // A mood that carries its own motion has to be seen without being pointed at, and so do eyes that
  // follow the pointer; the resting moods keep the hover gating that the perf note above is about.
  const animated = () => props.followPointer || plushMood().busy || !STATIC_MOTIONS.has(props.motion) || interacting();

  // Reduced motion keeps one face: it is a frozen plush, and a frozen plush cannot morph between faces.
  createEffect(
    () => cyclesFaces() && !reducedMotion(),
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
    const syncReducedMotion = () => setReducedMotion(media?.matches ?? false);
    syncReducedMotion();
    media?.addEventListener?.("change", syncReducedMotion);

    // What must be hovered or focused for a resting avatar to move: the control the avatar sits in or
    // beside, marked with `data-avatar-hover` when the avatar is only a neighbour of it. A dialog and a
    // scroll region are focusable as well, and taking one of those would start every avatar on it at once.
    const group = element?.closest<HTMLElement>(`${HOVER_GROUP}, [tabindex]`);
    const interactionTarget = group?.matches(HOVER_GROUP) ? group : element;
    const startInteraction = () => {
      if (!interacting()) setHoverFace((previous) => randomHoverFace(previous, restingExpression()));
      setInteracting(true);
    };
    const stopInteraction = () => setInteracting(false);
    // Only keyboard focus starts the avatar. A click leaves the focus on the button it lands on, such as
    // the sidebar row of the open channel, and the window gives that button `focusin` again each time it
    // comes back to the front. No pointer is there to leave, so the avatar moved until the next click.
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
      media?.removeEventListener?.("change", syncReducedMotion);
      interactionTarget?.removeEventListener("pointerenter", startInteraction);
      interactionTarget?.removeEventListener("pointerleave", stopInteraction);
      interactionTarget?.removeEventListener("focusin", startFocusInteraction);
      interactionTarget?.removeEventListener("focusout", stopFocusInteraction);
    };
  });

  // The plush plays one state and keeps its body still. On hover only the eyes move: drift, blinks,
  // and the face of the mood. At rest it is `paused`, not swapped for a frozen bot: it stops on the
  // pose on screen and resumes from it, and a change made while it rests still plays to its end. So a
  // new shape or colour always pops: the old body shrinks away and the new one springs out.
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
      // BloubBot pauses off screen by default, but PlushBot passes an unset `autoPause` through as
      // `undefined`, which turns the pause off. So it is set here.
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
        /* With reduced motion nothing moves, so the bot is frozen. A frozen Bloub frame cannot
             finish a morph, and the engine reads `state` only when it is built, so a mood change
             has to rebuild the bot. Keying on the appearance, state included, does both:
             `frozenAt` alone would sample the seeded idle face. A frozen plush shows a new body
             at once, with no transition. */
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

/** A hover face that differs from the resting eyes and from the face the last hover showed. */
function randomHoverFace(previous: HoverFace | null, resting: ExpressionId): HoverFace {
  const choices = HOVER_FACES.filter((face) => face !== previous && face.expression !== resting);
  return choices[Math.floor(Math.random() * choices.length)] ?? HOVER_WINK;
}

/** A random working face other than the one on screen, so each change shows. */
function nextWorkingFace(current: ExpressionId | null): ExpressionId {
  const choices = AVATAR_EXPRESSIONS.filter((face) => face !== current);
  return choices[Math.floor(Math.random() * choices.length)] ?? "attentif";
}

function avatarAnimationPhase(seed: string): number {
  let hash = 0x811c9dc5;
  for (let index = 0; index < seed.length; index += 1) {
    hash ^= seed.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return ((hash >>> 0) / 0x100000000) * 1.4;
}
