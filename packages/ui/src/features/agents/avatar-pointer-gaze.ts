import type { GazeScript } from "@norbert_bodziony/bloub";

// The head turn toward the pointer, in degrees. More than the bloub follow (16 and 13), so that the
// turn reads on a small avatar; at much more, the outer eye goes behind the edge of the ball.
const YAW_MAX = 24;
const PITCH_MAX = 16;
// The pitch with the pointer level with the avatar: a little up, so the agent looks awake.
const PITCH_LEVEL = 10;
// How far the pointer can go from an avatar before the head turn stops. A distance in pixels, not
// a part of the window, so that agents next to each other look at the pointer from their own place.
const REACH = 320;
// How fast the eyes come to the pointer, per second. The engine applies each look at once.
const FOLLOW_RATE = 9;
// A press makes the agent nod twice. A roll of the eyes around the ball would read better, but on
// a shape that is not a circle the eyes cross its edge.
const NOD_TIME = 0.55;
const NOD_PITCH = 14;

let pointer: { x: number; y: number } | null = null;
let watchers = 0;

function trackPointer(event: PointerEvent) {
  if (event.pointerType !== "touch") pointer = { x: event.clientX, y: event.clientY };
}

function forgetPointer(event: PointerEvent) {
  // Leaving the window is the only `pointerout` without a next target.
  if (event.relatedTarget === null) pointer = null;
}

/** Shares one pointer listener between all following avatars. Returns the release. */
function watchPointer(): () => void {
  if (watchers === 0) {
    window.addEventListener("pointermove", trackPointer, { passive: true });
    document.addEventListener("pointerout", forgetPointer, { passive: true });
  }
  watchers += 1;
  return () => {
    watchers -= 1;
    if (watchers > 0) return;
    window.removeEventListener("pointermove", trackPointer);
    document.removeEventListener("pointerout", forgetPointer);
    pointer = null;
  };
}

function clampUnit(value: number): number {
  return Math.min(1, Math.max(-1, value));
}

export interface PointerGaze {
  /** The bloub look for each frame. */
  script: GazeScript;
  /** Starts the pointer listener and the press nod on the avatar. Returns the release. */
  attach(element: Element): () => void;
}

/**
 * The eyes of one avatar follow the pointer. Without a known pointer (touch, or the pointer out of
 * the window) the look fades back to the face of the state, which drifts by itself. A press on the
 * avatar makes it nod.
 */
export function createPointerGaze(): PointerGaze {
  let element: Element | undefined;
  let last = 0;
  let yaw = 0;
  let pitch = PITCH_LEVEL;
  let mix = 0;
  let nodPending = false;
  let nodStart: number | null = null;

  const script: GazeScript = (time) => {
    const step = Math.min(Math.max(time - last, 0), 0.1);
    last = time;
    const ease = 1 - Math.exp(-step * FOLLOW_RATE);
    const at = pointer;
    const box = element?.getBoundingClientRect();
    const known = at !== null && box !== undefined && box.width > 0;
    if (known) {
      const x = clampUnit((at.x - (box.left + box.width / 2)) / REACH);
      const y = clampUnit((at.y - (box.top + box.height / 2)) / REACH);
      yaw += (x * YAW_MAX - yaw) * ease;
      pitch += (PITCH_LEVEL - y * PITCH_MAX - pitch) * ease;
    }
    mix += ((known ? 1 : 0) - mix) * ease;

    if (nodPending) {
      nodPending = false;
      nodStart = time;
    }
    let nod = 0;
    if (nodStart !== null) {
      const progress = Math.min(1, (time - nodStart) / NOD_TIME);
      nod = -NOD_PITCH * Math.sin(progress * 4 * Math.PI) * (1 - progress);
      if (progress >= 1) nodStart = null;
    }
    // The nod is part of the look, so a touch press, with no pointer to follow, does not nod.
    return { yaw, pitch: pitch + nod, mix, spin: 0, wander: 1 - mix };
  };

  return {
    script,
    attach(target) {
      element = target;
      const nod = () => {
        if (nodStart === null) nodPending = true;
      };
      const release = watchPointer();
      target.addEventListener("pointerdown", nod);
      return () => {
        release();
        target.removeEventListener("pointerdown", nod);
        element = undefined;
      };
    },
  };
}
