/**
 * The shape and the motion of the agent dock. The dock, the chat panel, the neck between them and
 * the drop that carries an agent in or out are one liquid under an SVG "goo" filter. These functions
 * give their geometry, in px, and a small spring engine moves them.
 */

import { prefersReducedMotion } from "../../utils";

export const SEAT = 44;
const SEAT_GAP = 10;
export const DOCK_PAD = 10;
export const DOCK_WIDTH = SEAT + DOCK_PAD * 2;
/** The space between the panel and the dock. The neck fills it at the open agent's row. */
export const PANEL_GAP = 18;
export const PANEL_WIDTH = 380;
export const PANEL_HEIGHT = 560;
export const PANEL_RADIUS = 24;
export const STAGE_WIDTH = PANEL_WIDTH + PANEL_GAP + DOCK_WIDTH;
export const DOCK_LEFT = STAGE_WIDTH - DOCK_WIDTH;
export const SEAT_CENTER_X = DOCK_LEFT + DOCK_WIDTH / 2;
/** The strip of window frame on the right edge. The dock grows out of its inner edge. */
const FRAME_EDGE = 5;
/**
 * The profile of each dock end, as points [width from the frame, distance from the end of the dock
 * side's straight part]. Width 84.8 is the full dock. A round shoulder turns until the edge is
 * perpendicular to the frame at the bend; then a concave tail runs into the frame along it, so the
 * dock seems to grow out of the frame. Each segment is a cubic curve: two control points and its end.
 */
const PROFILE_WIDTH = 84.8;
type ProfilePoint = readonly [width: number, distance: number];
const PROFILE_START: ProfilePoint = [PROFILE_WIDTH, 0];
const PROFILE: readonly (readonly [ProfilePoint, ProfilePoint, ProfilePoint])[] = [
  // The shoulder.
  [
    [84.8, 15],
    [70, 30],
    [54, 30],
  ],
  // The tail: it leaves the bend flat, then bends down and meets the frame almost along it.
  [
    [36, 30],
    [24, 34.5],
    [19, 38],
  ],
  [
    [11, 43.5],
    [2, 54],
    [0, 64],
  ],
];
const BEND = 30;
/**
 * The handle below the dock: a quarter circle beside the bottom tail, from its top end above the
 * centre to its bottom end right of the centre. Profile units.
 */
const HANDLE_CENTER: ProfilePoint = [49.6, 80.5];
const HANDLE_RADIUS = 34.3;
/** The width of the handle stroke, in px. */
export const HANDLE_STROKE = 4;

/**
 * The open progress at which the blob is clear of the dock. Before it, the blob slides out and swells
 * to the dock's height; after it, the blob grows to the full panel.
 */
export const SLIDE_END = 0.42;
/** The liquid layer starts 40px before the stage and runs 60px past the window edge. */
export const LIQUID_PAD = 40;
export const LIQUID_WIDTH = STAGE_WIDTH + LIQUID_PAD + 60;
export const LIQUID_HEIGHT = PANEL_HEIGHT + LIQUID_PAD * 2;

/** The distance from one seat to the next. */
export const SEAT_PITCH = SEAT + SEAT_GAP;
/**
 * The seats show this tall at most: eight seats and half of the next one. More seats scroll, and the
 * half seat at the faded edge shows that the list goes on. The dock then fits in the window.
 */
const MAX_SEAT_VIEW = 8 * SEAT_PITCH + SEAT / 2;
/** The seat view starts this far above the first seat, so an open or hovered seat, which is larger, is not cut. */
export const SEAT_VIEW_INSET = 4;

/** The height of all seats and the gap below each one. */
export function seatsHeight(seats: number): number {
  return seats * SEAT_PITCH;
}

/** The part of `seatsHeight` that the dock shows. The rest scrolls. */
export function seatView(seats: number): number {
  return Math.min(seatsHeight(seats), MAX_SEAT_VIEW);
}

export function dockHeight(seats: number): number {
  return DOCK_PAD * 2 + seatView(seats) + SEAT;
}

/** The top of the seat view for a dock of this height, before the stretch of a drag. */
export function seatViewTop(height: number): number {
  return (PANEL_HEIGHT - height) / 2 + DOCK_PAD - SEAT_VIEW_INSET;
}

/** The centre y of a seat when the seat view is not scrolled. */
export function seatCenterY(index: number, seats: number): number {
  return seatViewTop(dockHeight(seats)) + SEAT_VIEW_INSET + index * SEAT_PITCH + SEAT / 2;
}

/** The centre y of the add button, below the seat view. */
export function addCenterY(seats: number): number {
  return seatViewTop(dockHeight(seats)) + SEAT_VIEW_INSET + seatView(seats) + SEAT / 2;
}

/**
 * The vertical extent of the dock body in liquid-layer coordinates. `stretch` pulls one end out: a
 * positive value pulls the top end up, a negative value pulls the bottom end down.
 */
export function dockBand(height: number, stretch = 0) {
  const top = LIQUID_PAD + (PANEL_HEIGHT - height) / 2;
  return { top: top - Math.max(0, stretch), bottom: top + height + Math.max(0, -stretch) };
}

/**
 * A smooth curve through `start` at 0, `middle` at SLIDE_END and `end` at 1. It eases out of `start`,
 * keeps one speed through `middle` (no overshoot), and past 1 it continues in a straight line for the
 * spring's overshoot.
 */
export function stagedCurve(progress: number, start: number, middle: number, end: number) {
  const first = (middle - start) / SLIDE_END;
  const second = (end - middle) / (1 - SLIDE_END);
  const limit = Math.min(Math.abs(first), Math.abs(second)) * 3;
  const through = Math.sign(end - start) * Math.min(Math.abs(end - start), limit);
  const hermite = (t: number, from: number, to: number, slopeFrom: number, slopeTo: number, span: number) => {
    const t2 = t * t;
    const t3 = t2 * t;
    return (
      (2 * t3 - 3 * t2 + 1) * from +
      (t3 - 2 * t2 + t) * span * slopeFrom +
      (-2 * t3 + 3 * t2) * to +
      (t3 - t2) * span * slopeTo
    );
  };
  if (progress <= SLIDE_END) return hermite(progress / SLIDE_END, start, middle, 0, through, SLIDE_END);
  if (progress <= 1)
    return hermite((progress - SLIDE_END) / (1 - SLIDE_END), middle, end, through, second, 1 - SLIDE_END);
  return end + second * (progress - 1);
}

/** The scale and the placement of the dock-end profile. Liquid-layer coordinates. */
function profileFrame(height: number, stretch: number) {
  const { top, bottom } = dockBand(height, stretch);
  const side = LIQUID_PAD + DOCK_LEFT;
  const frame = LIQUID_PAD + STAGE_WIDTH - FRAME_EDGE;
  const scale = (frame - side) / PROFILE_WIDTH;
  const x = (width: number) => frame - width * scale;
  // The shoulder sits inside the band and the tail outside it, so the bend is on the band edge.
  const up = (distance: number) => top + (BEND - distance) * scale;
  const down = (distance: number) => bottom - (BEND - distance) * scale;
  return { frame, scale, x, up, down };
}

/**
 * The dock: each end of its side has a round shoulder and then a concave tail that runs into the
 * window frame, so the dock seems to grow out of the frame. Liquid-layer coordinates.
 */
export function dockPath(height: number, stretch = 0) {
  const { frame, x, up, down } = profileFrame(height, stretch);
  const right = LIQUID_WIDTH;
  const point = (place: (distance: number) => number, [width, distance]: ProfilePoint) =>
    `${x(width)} ${place(distance)}`;
  // The top end runs from the tip to the side, so it takes each segment backwards.
  const topEnd: string[] = [];
  const bottomEnd: string[] = [];
  let from = PROFILE_START;
  for (const [first, second, end] of PROFILE) {
    bottomEnd.push(`C ${point(down, first)} ${point(down, second)} ${point(down, end)}`);
    topEnd.unshift(`C ${point(up, second)} ${point(up, first)} ${point(up, from)}`);
    from = end;
  }
  const tipTop = up(from[1]);
  const tipBottom = down(from[1]);
  return [
    `M ${right} ${tipTop - 20}`,
    `L ${frame} ${tipTop - 20}`,
    `L ${frame} ${tipTop}`,
    ...topEnd,
    `L ${point(down, PROFILE_START)}`,
    ...bottomEnd,
    `L ${frame} ${tipBottom + 20}`,
    `L ${right} ${tipBottom + 20}`,
    "Z",
  ].join(" ");
}

/** The handle below the dock: an arc beside the bottom tail. Liquid-layer coordinates. */
export function dockHandlePath(height: number, stretch = 0) {
  const { scale, x, down } = profileFrame(height, stretch);
  const [width, distance] = HANDLE_CENTER;
  const radius = HANDLE_RADIUS * scale;
  const startX = x(width);
  const startY = down(distance - HANDLE_RADIUS);
  const endX = x(width - HANDLE_RADIUS);
  const endY = down(distance);
  return `M ${startX} ${startY} A ${radius} ${radius} 0 0 1 ${endX} ${endY}`;
}

/**
 * The neck between the panel and the dock: an hourglass whose ends flare into both sides along
 * S-curves. `size` 0 is no neck and 1 is the full neck. Liquid-layer coordinates.
 */
export function neckPath(centerY: number, size: number) {
  if (size <= 0) return "";
  const y = LIQUID_PAD + centerY;
  const panel = LIQUID_PAD + DOCK_LEFT - PANEL_GAP;
  const dock = LIQUID_PAD + DOCK_LEFT;
  const middle = (panel + dock) / 2;
  const waist = 10 * size;
  const reach = waist + 20 * size;
  const bend = PANEL_GAP * 0.3;
  const half = (sign: 1 | -1) => {
    const edge = y + sign * reach;
    const narrow = y + sign * waist;
    const pull = y + sign * (waist + (reach - waist) * 0.35);
    return { edge, narrow, pull };
  };
  const t = half(-1);
  const b = half(1);
  return [
    `M ${panel - 12} ${t.edge}`,
    `L ${panel} ${t.edge}`,
    `C ${panel} ${t.pull} ${middle - bend} ${t.narrow} ${middle} ${t.narrow}`,
    `C ${middle + bend} ${t.narrow} ${dock} ${t.pull} ${dock} ${t.edge}`,
    `L ${dock + 12} ${t.edge}`,
    `L ${dock + 12} ${b.edge}`,
    `L ${dock} ${b.edge}`,
    `C ${dock} ${b.pull} ${middle + bend} ${b.narrow} ${middle} ${b.narrow}`,
    `C ${middle - bend} ${b.narrow} ${panel} ${b.pull} ${panel} ${b.edge}`,
    `L ${panel - 12} ${b.edge}`,
    "Z",
  ].join(" ");
}

/* ---------- A small spring engine ---------- */

export interface SpringConfig {
  stiffness: number;
  damping: number;
}

export const SOFT: SpringConfig = { stiffness: 170, damping: 19 };
export const SNAPPY: SpringConfig = { stiffness: 320, damping: 24 };
export const WOBBLY: SpringConfig = { stiffness: 210, damping: 13 };
/** The panel opens with a small overshoot and closes with none, so it does not snap into the seat. */
export const PANEL_OPEN: SpringConfig = { stiffness: 190, damping: 19 };
export const PANEL_CLOSE: SpringConfig = { stiffness: 280, damping: 33 };
/** The stretch follows the drag speed closely; when the dock stops, it settles with a wobble (WOBBLY). */
export const STRETCH_FOLLOW: SpringConfig = { stiffness: 300, damping: 30 };
/** The dock slides out of the edge with a small overshoot, so it seems to flow out of the frame. */
export const TUCK: SpringConfig = { stiffness: 260, damping: 22 };
/** The longest pull of a dock end during a drag, in px. */
export const MAX_STRETCH = 14;
/** The pull of a dock end for each px/ms of drag speed. */
export const STRETCH_PER_SPEED = 9;
/** The distance that a tucked dock slides into the edge: past the liquid that the filter spreads. */
export const TUCK_DISTANCE = 96;

export class Spring {
  velocity = 0;
  target: number;
  private onRest: (() => void) | null = null;

  constructor(
    public value: number,
    private config: SpringConfig,
  ) {
    this.target = value;
  }

  to(target: number, onRest?: () => void, config?: SpringConfig) {
    this.target = target;
    if (config) this.config = config;
    this.onRest = onRest ?? null;
    if (prefersReducedMotion()) this.jump(target);
  }

  jump(value: number) {
    this.value = value;
    this.target = value;
    this.velocity = 0;
  }

  /** Advances by `dt` seconds. Returns true while the spring still moves. */
  step(dt: number): boolean {
    const force = -this.config.stiffness * (this.value - this.target) - this.config.damping * this.velocity;
    this.velocity += force * dt;
    this.value += this.velocity * dt;
    if (Math.abs(this.velocity) < 0.01 && Math.abs(this.value - this.target) < 0.005) {
      this.value = this.target;
      this.velocity = 0;
      const rest = this.onRest;
      this.onRest = null;
      rest?.();
      return false;
    }
    return true;
  }
}

/**
 * Steps every spring each frame and calls `render`, until all of them rest. `onActivity` is told when
 * the springs start to move and when all of them rest again.
 */
export function createMotion(render: () => void, onActivity?: (moving: boolean) => void) {
  const springs = new Set<Spring>();
  let frame = 0;
  let last = 0;
  const tick = (now: number) => {
    const dt = Math.min(1 / 30, (now - last) / 1000 || 1 / 60);
    last = now;
    let moving = false;
    // Small sub-steps keep stiff springs stable.
    for (const spring of springs) {
      let springMoving = false;
      for (let i = 0; i < 4; i++) springMoving = spring.step(dt / 4) || springMoving;
      moving = springMoving || moving;
    }
    render();
    frame = moving ? requestAnimationFrame(tick) : 0;
    if (!moving) onActivity?.(false);
  };
  return {
    spring(value: number, config: SpringConfig) {
      const spring = new Spring(value, config);
      springs.add(spring);
      return spring;
    },
    drop(spring: Spring) {
      springs.delete(spring);
    },
    kick() {
      if (frame) return;
      last = performance.now();
      frame = requestAnimationFrame(tick);
      onActivity?.(true);
    },
    stop() {
      cancelAnimationFrame(frame);
      frame = 0;
    },
  };
}
