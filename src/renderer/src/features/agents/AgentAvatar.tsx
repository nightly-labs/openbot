import {
  type Block,
  BloubBot,
  BotEngine,
  type BotFrame,
  DEMI_VIEWBOX,
  defaultCycle,
  makeBlock,
  POSES,
  RAYON,
  type StateId,
} from "@norbert_bodziony/bloub";
import type { AvatarHue } from "@openbot/contracts/ipc";
import { createEffect, createMemo, createSignal, createUniqueId, For, onSettled, Show } from "solid-js";
import { type AvatarMotion, bloubAvatarProfile, type SupportedAvatarSilhouetteId } from "../../bloub-avatar";
import { TypingDots } from "../../components/TypingDots";
import { prefersReducedMotion } from "../../components/ui/utils";
import type { AgentProfile } from "../../data";

const DEFAULT_CYCLE: Block[] = defaultCycle().blocks;
// An avatar is 24 to 40 px of morphing blob, and every drawn frame costs a style
// recalculation, a layout and a paint. Left at the screen's rate, two visible
// avatars measured 30% of the renderer process and 24% of the GPU process; a cap
// the eye cannot see on a shape this small gives most of that back. bloub keeps
// its clock uncapped, so the animation is drawn less often, never delayed.
const AVATAR_FPS = 30;
const SIDEBAR_MOTION_HOLD_FACTOR = 1.25;
const IDLE_CYCLE: Block[] = [slowerBlock("idle")];
const WORKING_CYCLE: Block[] = [slowerBlock("orbit")];
const CONNECTING_CYCLE: Block[] = [makeBlock("orbit"), makeBlock("swirl")];

// The motions that rest until the pointer or focus arrives. `idle` is here
// because it is what a sidebar row shows while its agent does nothing, and the
// sidebar is not virtualized, so every row animates for as long as the list is
// on screen. A profile of an idle window found four `idle` avatars driving 83
// style recalculations a second, and that did not fall when the window lost
// focus or was minimized. `working` and `connecting` keep animating: motion is
// the only sidebar signal that an agent runs.
const STATIC_MOTIONS: ReadonlySet<AvatarMotion> = new Set(["hover", "idle"]);

function slowerBlock(state: StateId): Block {
  const block = makeBlock(state);
  return { ...block, duration: block.duration * SIDEBAR_MOTION_HOLD_FACTOR };
}

interface AgentAvatarProps {
  agent?: Pick<AgentProfile, "avatarSeed" | "avatarHue" | "avatarUrl">;
  seed?: string;
  hue?: AvatarHue | null;
  url?: string | null;
  motion?: AvatarMotion;
  cycleOffset?: number;
  animationOffset?: number;
  animationState?: StateId;
  shape?: SupportedAvatarSilhouetteId;
  class?: string;
  style?: Record<string, string>;
}

export function AgentAvatar(props: AgentAvatarProps) {
  const seed = () => props.seed ?? props.agent?.avatarSeed ?? "agent";
  const hue = () => (props.hue !== undefined ? props.hue : (props.agent?.avatarHue ?? null));
  const motion = () => props.motion ?? "hover";
  const url = () => (props.url !== undefined ? props.url : (props.agent?.avatarUrl ?? null));
  const [imageFailed, setImageFailed] = createSignal(false);
  createEffect(
    () => url(),
    () => {
      setImageFailed(false);
    },
  );
  const className = () => `agent-avatar agent-avatar-motion-${motion()} ${props.class ?? ""}`;
  return (
    <Show
      when={url() && !imageFailed()}
      fallback={
        <GeneratedAvatar
          seed={seed()}
          hue={hue()}
          motion={motion()}
          cycleOffset={props.cycleOffset}
          animationOffset={props.animationOffset}
          animationState={props.animationState}
          shape={props.shape}
          class={className()}
          style={props.style}
        />
      }
    >
      <span
        class={`${className()} agent-avatar-custom`}
        style={props.style}
        data-avatar={props.animationState === "thinking" ? "dots" : "image"}
        data-animation-state={props.animationState}
        aria-hidden="true"
      >
        {/* A photo cannot morph, so the Bloub's own activity decor is drawn around it:
            `thinking` hides the body behind three dots, every other state flies its rings. */}
        <Show when={props.animationState !== "thinking"} fallback={<TypingDots class="agent-avatar-dots" />}>
          <Show
            when={props.animationState}
            fallback={<AvatarImage url={url()} onFailed={() => setImageFailed(true)} />}
          >
            {(animationState) => (
              <OrbitedAvatarImage url={url()} animationState={animationState()} onFailed={() => setImageFailed(true)} />
            )}
          </Show>
        </Show>
      </span>
    </Show>
  );
}

function AvatarImage(props: { url: string | null; onFailed: () => void }) {
  return <img src={props.url ?? ""} alt="" draggable={false} onError={() => props.onFailed()} />;
}

// A pose whose decor a photo can wear. `burst` and `wide` carry theirs in the
// body and the face, which a photo replaces, so they would leave it still for
// the whole turn; they borrow the orbit rings instead. Asked of the engine
// rather than listed here, so a pose that gains or loses rings upstream needs
// no edit.
function ringPose(state: StateId): StateId {
  return new BotEngine(RAYON, state).sample(POSES[state]).arcs.length > 0 ? state : "orbit";
}

// The rings an orbiting Bloub flies, around a photo instead of a body. They come
// from the engine rather than from CSS so that a custom avatar and a generated one
// in the same row carry the same decor: the same ellipses at the same speed, each
// split into the half behind the head and the half in front of it. The image sits
// between those halves, which is what makes them read as orbits.
function OrbitedAvatarImage(props: { url: string | null; animationState: StateId; onFailed: () => void }) {
  let pose = ringPose(props.animationState);
  let elapsed = POSES[pose];
  let ringsSeen = false;
  const engine = new BotEngine(RAYON, pose);
  const [frame, setFrame] = createSignal(engine.sample(elapsed), { equals: false });

  createEffect(
    () => props.animationState,
    (state) => {
      const next = ringPose(state);
      // The effect also runs on mount, where the engine already holds the pose.
      if (next === pose) return;
      pose = next;
      ringsSeen = false;
      engine.reset(next, elapsed);
    },
  );

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
      // A pose plays once, and its rings fade out before it ends — orbit holds
      // them for 3.6s of a 4.3s block. The body keeps the generated avatar alive
      // through that tail; a photo would simply stop. So the pose restarts on the
      // frame its rings run out, which is the engine's own measure of the cycle
      // rather than a duration restated here.
      if (ringsSeen && sampled.arcs.length === 0) {
        ringsSeen = false;
        engine.reset(pose, elapsed);
        sampled = engine.sample(elapsed);
      }
      ringsSeen ||= sampled.arcs.length > 0;
      setFrame(sampled);
    };
    handle = requestAnimationFrame(step);
    return () => cancelAnimationFrame(handle);
  });

  return (
    <>
      <AvatarArcs arcs={frame().arcs} half="back" />
      <AvatarImage url={props.url} onFailed={props.onFailed} />
      <AvatarArcs arcs={frame().arcs} half="front" />
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
  cycleOffset?: number;
  animationOffset?: number;
  animationState?: StateId;
  shape?: SupportedAvatarSilhouetteId;
  class: string;
  style?: Record<string, string>;
}) {
  let element: HTMLSpanElement | undefined;
  const [interacting, setInteracting] = createSignal(false);
  const [reducedMotion, setReducedMotion] = createSignal(prefersReducedMotion());
  const frozenAt = props.animationState ? POSES[props.animationState] : 0;
  const profile = createMemo(() => bloubAvatarProfile(props.seed, props.hue));
  const cycle = createMemo(() => offsetCycle(DEFAULT_CYCLE, props.cycleOffset ?? 0));
  const animated = () =>
    !reducedMotion() && (Boolean(props.animationState) || !STATIC_MOTIONS.has(props.motion) || interacting());
  const motionCycle = () => {
    if (props.animationState) return [slowerBlock(props.animationState)];
    if (props.motion === "connecting") return CONNECTING_CYCLE;
    if (props.motion === "idle") return IDLE_CYCLE;
    if (props.motion === "working") return WORKING_CYCLE;
    return cycle();
  };

  onSettled(() => {
    const media = window.matchMedia?.("(prefers-reduced-motion: reduce)");
    const syncReducedMotion = () => setReducedMotion(media?.matches ?? false);
    syncReducedMotion();
    media?.addEventListener?.("change", syncReducedMotion);

    const interactionTarget = element?.closest<HTMLElement>("button, a, [role='button'], [tabindex]") ?? element;
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
      shape={props.shape ?? profile().shape}
      color={profile().color}
      expression={profile().expression}
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
      data-animation-state={props.animationState}
      aria-hidden="true"
    >
      <Show
        when={animated()}
        fallback={
          // A frozen Bloub frame cannot finish a shape morph. Recreate it when the profile changes.
          <Show when={profile()} keyed>
            {(appearance) => (
              <BloubBot
                size={100}
                shape={props.shape ?? appearance.shape}
                color={appearance.color}
                expression={appearance.expression}
                frozenAt={frozenAt}
                ariaLabel=""
                class="bloub-avatar-svg"
              />
            )}
          </Show>
        }
      >
        {avatar()}
      </Show>
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
