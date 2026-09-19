import {
  type Block,
  BloubBot,
  BotEngine,
  type BotFrame,
  DEMI_VIEWBOX,
  makeBlock,
  POSES,
  RAYON,
} from "@norbert_bodziony/bloub";
import {
  type AvatarMood,
  avatarMoodIsBusy,
  avatarMoodPresentation,
  type ShapeSafeStateId,
} from "@openbot/brand/bloub-avatar-motion";
import type { AvatarHue } from "@openbot/contracts/ipc";
import type { JSX } from "@solidjs/web";
import { createEffect, createMemo, createSignal, createUniqueId, For, onSettled, Show } from "solid-js";
import { type AvatarMotion, bloubAvatarProfile, type SupportedAvatarSilhouetteId } from "../../bloub-avatar";
import { prefersReducedMotion } from "../../components/ui/utils";
import type { AgentProfile } from "../../data";

// An avatar is 24 to 40 px of morphing blob, and every drawn frame costs a style
// recalculation, a layout and a paint. Left at the screen's rate, two visible
// avatars measured 30% of the renderer process and 24% of the GPU process; a cap
// the eye cannot see on a shape this small gives most of that back. bloub keeps
// its clock uncapped, so the animation is drawn less often, never delayed.
const AVATAR_FPS = 30;
const SIDEBAR_MOTION_HOLD_FACTOR = 1.25;

// The resting montage, played on hover and wherever an avatar is shown off. Every block is
// shape-safe, so the personality is in the face - a blink, a wink, a widening of the eyes - and
// the silhouette the seed chose is on screen the whole way through. It used to be bloub's
// `defaultCycle()`, which walks the whole catalogue and turns the avatar into an egg, a hexagon
// and a comet on the way past.
const DEFAULT_CYCLE: Block[] = [
  slowerBlock("idle"),
  makeBlock("wink"),
  slowerBlock("idle"),
  makeBlock("wide"),
  slowerBlock("idle"),
];

// The pose the decor rings are sampled from. They are drawn around the avatar rather than played
// on it, because `orbit` is not shape-safe: as a state it replaces the body with its own.
const RING_POSE = "orbit";

// The motions that rest until the pointer or focus arrives. `idle` is here
// because it is what a sidebar row shows while its agent does nothing, and the
// sidebar is not virtualized, so every row animates for as long as the list is
// on screen. A profile of an idle window found four `idle` avatars driving 83
// style recalculations a second, and that did not fall when the window lost
// focus or was minimized. A mood that carries its own motion keeps animating:
// motion is the only sidebar signal that an agent runs.
const STATIC_MOTIONS: ReadonlySet<AvatarMotion> = new Set(["hover", "idle"]);

// Read from the avatar upwards: the first of these is its hover group. A `[tabindex]` element that
// matches none of them, such as the dialog or a scroll region, is too wide to be one. An item of a
// composite widget states its own group with `data-avatar-hover`.
const HOVER_GROUP = "[data-avatar-hover], button, a, [role='button'], [role='link'], [role='menuitem']";

function slowerBlock(state: ShapeSafeStateId): Block {
  const block = makeBlock(state);
  return { ...block, duration: block.duration * SIDEBAR_MOTION_HOLD_FACTOR };
}

interface AgentAvatarProps {
  agent?: Pick<AgentProfile, "avatarSeed" | "avatarHue" | "avatarUrl">;
  seed?: string;
  hue?: AvatarHue | null;
  url?: string | null;
  motion?: AvatarMotion;
  /** What the agent is doing. It chooses the face, never the silhouette. */
  mood?: AvatarMood;
  cycleOffset?: number;
  animationOffset?: number;
  shape?: SupportedAvatarSilhouetteId;
  class?: string;
  style?: Record<string, string>;
}

export function AgentAvatar(props: AgentAvatarProps) {
  const seed = () => props.seed ?? props.agent?.avatarSeed ?? "agent";
  const hue = () => (props.hue !== undefined ? props.hue : (props.agent?.avatarHue ?? null));
  const motion = () => props.motion ?? "hover";
  const url = () => (props.url !== undefined ? props.url : (props.agent?.avatarUrl ?? null));
  const mood = (): AvatarMood => props.mood ?? "idle";
  const presentation = () => avatarMoodPresentation(mood());
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
  const breathe = () => (presentation().breathe > 0 ? String(presentation().breathe) : undefined);
  const style = (): Record<string, string> => {
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
          motion={motion()}
          mood={mood()}
          cycleOffset={props.cycleOffset}
          animationOffset={props.animationOffset}
          shape={props.shape}
          breathe={breathe()}
          class={className()}
          style={style()}
        />
      }
    >
      <span
        class={`${className()} agent-avatar-custom`}
        style={style()}
        data-avatar="image"
        data-mood={mood()}
        data-breathe={breathe()}
        aria-hidden="true"
      >
        {/* A photo cannot wear an expression, so the Bloub's own decor carries the mood around it.
            A working agent used to hide behind three dots, which hid the one thing the person
            chose; it now keeps its face and flies the same rings the generated avatar does. */}
        <AvatarRings when={presentation().rings}>
          <AvatarImage url={url()} onFailed={() => setImageFailed(true)} />
        </AvatarRings>
      </span>
    </Show>
  );
}

function AvatarImage(props: { url: string | null; onFailed: () => void }) {
  return <img src={props.url ?? ""} alt="" draggable={false} onError={() => props.onFailed()} />;
}

/**
 * The rings an orbiting Bloub flies, around the avatar instead of in place of it.
 *
 * They come from the engine rather than from CSS so that a custom avatar and a generated one in
 * the same row carry the same decor: the same ellipses at the same speed, each split into the half
 * behind the head and the half in front of it. What sits between those halves - a photo or the
 * Bloub's own body - is what makes them read as orbits.
 *
 * Sampling them from a second engine is what lets a working avatar keep its silhouette. `orbit` as
 * a *state* is not shape-safe: it replaces the body with its own. Taking only `frame.arcs` from it
 * leaves that body behind and keeps the motion.
 */
function AvatarRings(props: { when: boolean; children: JSX.Element }) {
  return (
    <Show when={props.when} fallback={props.children}>
      <OrbitRings>{props.children}</OrbitRings>
    </Show>
  );
}

function OrbitRings(props: { children: JSX.Element }) {
  let elapsed = POSES[RING_POSE];
  let ringsSeen = false;
  const engine = new BotEngine(RAYON, RING_POSE);
  const [arcs, setArcs] = createSignal<BotFrame["arcs"]>(engine.sample(elapsed).arcs, { equals: false });

  onSettled(() => {
    if (prefersReducedMotion()) return;
    let handle = 0;
    let previousFrameAt = 0;
    let drawnAt = -Infinity;
    const step = (now: number) => {
      handle = requestAnimationFrame(step);
      elapsed += previousFrameAt ? Math.min((now - previousFrameAt) / 1000, 0.064) : 0;
      previousFrameAt = now;
      if (elapsed - drawnAt < 1 / AVATAR_FPS) return;
      drawnAt = elapsed;
      let sampled = engine.sample(elapsed);
      // A pose plays once, and its rings fade out before it ends - orbit holds them for 3.6s of a
      // 4.3s block. So the pose restarts on the frame its rings run out, which is the engine's own
      // measure of the cycle rather than a duration restated here.
      if (ringsSeen && sampled.arcs.length === 0) {
        ringsSeen = false;
        engine.reset(RING_POSE, elapsed);
        sampled = engine.sample(elapsed);
      }
      ringsSeen ||= sampled.arcs.length > 0;
      setArcs(sampled.arcs);
    };
    handle = requestAnimationFrame(step);
    return () => cancelAnimationFrame(handle);
  });

  return (
    <>
      <AvatarArcs arcs={arcs()} half="back" />
      {props.children}
      <AvatarArcs arcs={arcs()} half="front" />
    </>
  );
}

function AvatarArcs(props: { arcs: BotFrame["arcs"]; half: "back" | "front" }) {
  const gradientId = createUniqueId();
  return (
    <svg
      class="agent-avatar-arcs"
      viewBox={`${-DEMI_VIEWBOX} ${-DEMI_VIEWBOX} ${DEMI_VIEWBOX * 2} ${DEMI_VIEWBOX * 2}`}
      fill="none"
      stroke-linecap="round"
      aria-hidden="true"
    >
      <defs>
        <For each={props.arcs} keyed={false}>
          {(arc) => (
            <linearGradient
              id={`${gradientId}-${arc().id}`}
              gradientUnits="userSpaceOnUse"
              x1={arc().grad.x1}
              y1={arc().grad.y1}
              x2={arc().grad.x2}
              y2={arc().grad.y2}
            >
              <For each={arc().grad.stops} keyed={false}>
                {(stop, index) => (
                  <stop offset={index / Math.max(1, arc().grad.stops.length - 1)} stop-color={stop()} />
                )}
              </For>
            </linearGradient>
          )}
        </For>
      </defs>
      <For each={props.arcs} keyed={false}>
        {(arc) => (
          <path
            d={props.half === "back" ? arc().back : arc().front}
            stroke={`url(#${gradientId}-${arc().id})`}
            stroke-width={arc().width}
            opacity={arc().opacity}
          />
        )}
      </For>
    </svg>
  );
}

function GeneratedAvatar(props: {
  seed: string;
  hue: AvatarHue | null;
  motion: AvatarMotion;
  mood: AvatarMood;
  cycleOffset?: number;
  animationOffset?: number;
  shape?: SupportedAvatarSilhouetteId;
  breathe?: string;
  class: string;
  style?: Record<string, string>;
}) {
  let element: HTMLSpanElement | undefined;
  const [interacting, setInteracting] = createSignal(false);
  const [reducedMotion, setReducedMotion] = createSignal(prefersReducedMotion());
  const presentation = createMemo(() => avatarMoodPresentation(props.mood));
  const profile = createMemo(() => bloubAvatarProfile(props.seed, props.hue));
  // The silhouette and the colour are identity and come only from the seed. The mood may lend the
  // face an expression; when it does not, the seeded one is the resting face.
  const appearance = createMemo(() => ({
    shape: props.shape ?? profile().shape,
    color: profile().color,
    expression: presentation().expression ?? profile().expression,
  }));
  const cycle = createMemo(() => offsetCycle(DEFAULT_CYCLE, props.cycleOffset ?? 0));
  // A mood that carries its own motion has to be seen without being pointed at; the resting moods
  // keep the hover gating that the perf note above is about.
  const animated = () =>
    !reducedMotion() && (avatarMoodIsBusy(props.mood) || !STATIC_MOTIONS.has(props.motion) || interacting());
  const motionCycle = () => {
    if (props.mood !== "idle") return [slowerBlock(presentation().state)];
    return cycle();
  };

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
    const startInteraction = () => setInteracting(true);
    const stopInteraction = () => setInteracting(false);
    const stopFocusInteraction = (event: FocusEvent) => {
      if (!(event.relatedTarget instanceof Node) || !interactionTarget?.contains(event.relatedTarget)) {
        stopInteraction();
      }
    };
    interactionTarget?.addEventListener("pointerenter", startInteraction);
    interactionTarget?.addEventListener("pointerleave", stopInteraction);
    interactionTarget?.addEventListener("focusin", startInteraction);
    interactionTarget?.addEventListener("focusout", stopFocusInteraction);

    return () => {
      media?.removeEventListener?.("change", syncReducedMotion);
      interactionTarget?.removeEventListener("pointerenter", startInteraction);
      interactionTarget?.removeEventListener("pointerleave", stopInteraction);
      interactionTarget?.removeEventListener("focusin", startInteraction);
      interactionTarget?.removeEventListener("focusout", stopFocusInteraction);
    };
  });

  const avatar = () => (
    <BloubBot
      size={100}
      shape={appearance().shape}
      color={appearance().color}
      expression={appearance().expression}
      cycle={motionCycle()}
      playing={true}
      fps={AVATAR_FPS}
      initialPhase={props.animationOffset ?? avatarAnimationPhase(props.seed)}
      ariaLabel=""
      class="bloub-avatar-svg"
    />
  );

  return (
    <span
      ref={element}
      class={`${props.class} agent-avatar-bloub`}
      style={props.style}
      data-avatar="generated"
      data-mood={props.mood}
      data-breathe={props.breathe}
      aria-hidden="true"
    >
      <AvatarRings when={presentation().rings}>
        <Show
          when={animated()}
          fallback={
            // A frozen Bloub frame cannot finish a morph. Recreate it when the appearance changes.
            <Show when={appearance()} keyed>
              {(frozen) => (
                <BloubBot
                  size={100}
                  shape={frozen.shape}
                  color={frozen.color}
                  expression={frozen.expression}
                  frozenAt={POSES[presentation().state]}
                  ariaLabel=""
                  class="bloub-avatar-svg"
                />
              )}
            </Show>
          }
        >
          {avatar()}
        </Show>
      </AvatarRings>
    </span>
  );
}

function avatarAnimationPhase(seed: string): number {
  let hash = 0x811c9dc5;
  for (let index = 0; index < seed.length; index += 1) {
    hash ^= seed.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return ((hash >>> 0) / 0x100000000) * 1.4;
}

function offsetCycle(blocks: Block[], offset: number): Block[] {
  if (blocks.length === 0) return blocks;
  const start = ((Math.trunc(offset) % blocks.length) + blocks.length) % blocks.length;
  if (start === 0) return blocks;
  return [...blocks.slice(start), ...blocks.slice(0, start)];
}
