/**
 * The shape and the motion of the agent dock. The dock, the chat panel, the neck between them and
 * the drop that carries an agent in or out are one liquid under an SVG "goo" filter. These functions
 * give their geometry, in px. The tab profile and the spring engine are in `liquid.tsx`.
 */

import { edgeTabFrame, edgeTabPath, LIQUID_PAD, type ProfilePoint, type SpringConfig } from "../../liquid";

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

/** The dock on the frame edge, before and after the stretch of a drag. Liquid-layer coordinates. */
function dockTab(height: number, stretch: number) {
  const { top, bottom } = dockBand(height, stretch);
  return { frame: LIQUID_PAD + STAGE_WIDTH - FRAME_EDGE, side: LIQUID_PAD + DOCK_LEFT, start: top, end: bottom };
}

/**
 * The dock: each end of its side has a round shoulder and then a concave tail that runs into the
 * window frame, so the dock seems to grow out of the frame. Liquid-layer coordinates.
 */
export function dockPath(height: number, stretch = 0) {
  return edgeTabPath(dockTab(height, stretch), LIQUID_WIDTH, (across, along) => `${across} ${along}`);
}

/** The handle below the dock: an arc beside the bottom tail. Liquid-layer coordinates. */
export function dockHandlePath(height: number, stretch = 0) {
  const { scale, across: x, down } = edgeTabFrame(dockTab(height, stretch));
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
