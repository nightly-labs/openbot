/**
 * The shape and the motion of the agent dock. The dock, the chat panel, the neck between them and
 * the drop that carries an agent in or out are one liquid under an SVG "goo" filter. These functions
 * give their geometry, in px. The goo filter and the spring engine are in `liquid.tsx`.
 */

import { LIQUID_PAD, type SpringConfig } from "../../liquid";

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

/** The liquid layer starts LIQUID_PAD before the stage and runs 60px past the window edge. */
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

/** How far the neck reaches above and below its centre at a size. */
function neckReach(size: number) {
  return 30 * size;
}

/**
 * The neck's centre, kept inside the dock's band. Beside the dock the liquid shows only in the band, so a
 * neck that springs past the top or the bottom seat (a wobble on the way to the first seat) would be cut flat.
 */
export function neckCenterInBand(centerY: number, size: number, height: number, stretch = 0) {
  const band = dockBand(height, stretch);
  const reach = neckReach(Math.max(0, size));
  const top = band.top - LIQUID_PAD + reach;
  const bottom = band.bottom - LIQUID_PAD - reach;
  if (top > bottom) return (top + bottom) / 2;
  return Math.min(bottom, Math.max(top, centerY));
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
  const reach = neckReach(size);
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

/* ---------- Dock springs ---------- */

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
