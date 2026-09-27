/* The motion of the image viewer. The timings and curves follow the Kobra lightbox. */

const SPRING_STOPS = 48;

/** A `linear()` easing that samples a damped spring. `frequency` is the undamped rate in rad/s. */
function springEasing(duration: number, damping: number, frequency: number): string {
  const stops = Array.from({ length: SPRING_STOPS + 1 }, (_, stop) => {
    const progress = stop / SPRING_STOPS;
    // The last stop lands on the target, so the element does not jump when the animation ends.
    const value = stop === SPRING_STOPS ? 1 : springValue((progress * duration) / 1000, damping, frequency);
    return `${value.toFixed(4)} ${(progress * 100).toFixed(2)}%`;
  });
  return `linear(${stops.join(", ")})`;
}

function springValue(seconds: number, damping: number, frequency: number): number {
  if (damping >= 1) return 1 - Math.exp(-frequency * seconds) * (1 + frequency * seconds);
  const damped = frequency * Math.sqrt(1 - damping ** 2);
  return (
    1 -
    Math.exp(-damping * frequency * seconds) *
      (Math.cos(damped * seconds) + ((damping * frequency) / damped) * Math.sin(damped * seconds))
  );
}

/* The image grows out of its thumbnail with a small overshoot, and goes back without one. */
export const ZOOM_IN: KeyframeAnimationOptions = { duration: 450, easing: springEasing(450, 0.78, 21) };
export const ZOOM_OUT_DURATION = 190;
export const ZOOM_OUT: KeyframeAnimationOptions = {
  duration: ZOOM_OUT_DURATION,
  easing: springEasing(ZOOM_OUT_DURATION, 1, 32.4),
  fill: "forwards",
};
export const IMAGE_FADE_IN: KeyframeAnimationOptions = { duration: 200, easing: "cubic-bezier(0.23, 1, 0.32, 1)" };
/* The image stays on the thumbnail after it lands, then fades out over it. */
const IMAGE_FADE_OUT_DURATION = 260;
export const IMAGE_FADE_OUT: KeyframeAnimationOptions = {
  duration: IMAGE_FADE_OUT_DURATION,
  easing: "linear",
  fill: "forwards",
};
export const IMAGE_FADE_OUT_KEYFRAMES: Keyframe[] = [
  { opacity: 1 },
  { opacity: 1, offset: ZOOM_OUT_DURATION / IMAGE_FADE_OUT_DURATION },
  { opacity: 0 },
];
export const TILE_HIDE_DURATION = 70;
export const BACKDROP_IN: KeyframeAnimationOptions = {
  duration: 380,
  delay: 60,
  easing: "cubic-bezier(0.45, 0, 0.55, 1)",
  fill: "backwards",
};
export const BACKDROP_OUT: KeyframeAnimationOptions = {
  duration: 200,
  easing: "cubic-bezier(0.33, 1, 0.68, 1)",
  fill: "forwards",
};
export const SLIDE: KeyframeAnimationOptions = { duration: 260, easing: "cubic-bezier(0.22, 1, 0.36, 1)" };

const RECEDE_FADE = { duration: 380, easing: "cubic-bezier(0.25, 0.46, 0.45, 0.94)" };
const RECEDE_MOVE = { duration: 460, easing: "cubic-bezier(0.23, 1, 0.32, 1)" };
const RETURN_FADE = { duration: 220, easing: "cubic-bezier(0.33, 1, 0.68, 1)" };
const RETURN_MOVE = { duration: 300, easing: "cubic-bezier(0.23, 1, 0.32, 1)" };
const RECEDE_BLUR = 6;
const RECEDE_SCALE = 0.9;
const RECEDE_MAX_SHIFT = 60;
const RECEDE_SHIFT_PER_PIXEL = 0.25;
const RECEDE_MAX_DELAY = 40;
const RECEDE_DELAY_PER_PIXEL = 0.1;

interface TileShift {
  x: number;
  y: number;
  delay: number;
}

/** A thumbnail moves away from the one that opened, a little more when it is further away. */
function tileShift(from: DOMRect, tile: DOMRect): TileShift {
  const x = tile.left + tile.width / 2 - (from.left + from.width / 2);
  const y = tile.top + tile.height / 2 - (from.top + from.height / 2);
  const distance = Math.hypot(x, y);
  if (distance === 0) return { x: 0, y: 0, delay: 0 };
  const length = Math.min(RECEDE_MAX_SHIFT, distance * RECEDE_SHIFT_PER_PIXEL);
  return {
    x: (x / distance) * length,
    y: (y / distance) * length,
    delay: Math.min(RECEDE_MAX_DELAY, distance * RECEDE_DELAY_PER_PIXEL),
  };
}

function tileKeyframes(shift: TileShift) {
  return {
    fade: [
      { opacity: 1, filter: "blur(0px)" },
      { opacity: 0, filter: `blur(${RECEDE_BLUR}px)` },
    ],
    move: [
      { scale: "1", translate: "0px 0px" },
      { scale: `${RECEDE_SCALE}`, translate: `${shift.x}px ${shift.y}px` },
    ],
  };
}

interface TileState {
  animations: Animation[];
  /** Set on a thumbnail that moved out of the way; unset on the one whose image the viewer shows. */
  shift?: TileShift;
}

/**
 * While the viewer is open, the thumbnail of the image it shows is hidden and the other thumbnails
 * of the message move out of the way. The thumbnail keeps its layout box, so the viewer can still
 * close into it.
 */
export function createTileMotion() {
  const tiles = new Map<HTMLElement, TileState>();
  const settle = (tile: HTMLElement) => {
    for (const animation of tiles.get(tile)?.animations ?? []) animation.cancel();
    tiles.delete(tile);
  };
  return {
    hide(tile: HTMLElement, duration: number) {
      settle(tile);
      const animation = tile.animate([{ opacity: 1 }, { opacity: 0 }], {
        duration,
        easing: "linear",
        fill: "forwards",
      });
      tiles.set(tile, { animations: [animation] });
    },
    recede(tile: HTMLElement, from: DOMRect, instant: boolean) {
      settle(tile);
      const shift = tileShift(from, tile.getBoundingClientRect());
      const { fade, move } = tileKeyframes(shift);
      const timing = (motion: { duration: number; easing: string }): KeyframeAnimationOptions => ({
        ...motion,
        duration: instant ? 0 : motion.duration,
        delay: instant ? 0 : shift.delay,
        fill: "both",
      });
      tiles.set(tile, {
        shift,
        animations: [tile.animate(fade, timing(RECEDE_FADE)), tile.animate(move, timing(RECEDE_MOVE))],
      });
    },
    /** Shows a hidden thumbnail again after `delay`, when the image lands on it. */
    restore(tile: HTMLElement, delay: number) {
      if (!tiles.has(tile)) return;
      settle(tile);
      tile.animate([{ opacity: 0 }, { opacity: 1 }], { duration: delay, easing: "steps(1)" });
    },
    /** Brings every thumbnail back. The animations run on after the viewer unmounts. */
    returnAll() {
      for (const [tile, { shift }] of [...tiles]) {
        settle(tile);
        if (!shift) continue;
        const { fade, move } = tileKeyframes(shift);
        const timing = (motion: { duration: number; easing: string }): KeyframeAnimationOptions => ({
          ...motion,
          delay: shift.delay,
          fill: "backwards",
        });
        tile.animate([...fade].reverse(), timing(RETURN_FADE));
        tile.animate([...move].reverse(), timing(RETURN_MOVE));
      }
    },
    cancel() {
      for (const tile of [...tiles.keys()]) settle(tile);
    },
  };
}
