import { type Block, BloubBot, defaultCycle, makeBlock, POSES, type StateId } from "@norbert_bodziony/bloub";
import type { AvatarHue } from "@openbot/contracts/ipc";
import { createEffect, createMemo, createSignal, onSettled, Show } from "solid-js";
import { type AvatarMotion, bloubAvatarProfile, type SupportedAvatarSilhouetteId } from "../../bloub-avatar";
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

// Read from the avatar upwards: the first of these is its hover group. A `[tabindex]` element that
// matches none of them, such as the dialog or a scroll region, is too wide to be one. An item of a
// composite widget states its own group with `data-avatar-hover`.
const HOVER_GROUP = "[data-avatar-hover], button, a, [role='button'], [role='link'], [role='menuitem']";

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
      <span class={`${className()} agent-avatar-custom`} style={props.style} aria-hidden="true">
        <img src={url() ?? ""} alt="" draggable={false} onError={() => setImageFailed(true)} />
      </span>
    </Show>
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
