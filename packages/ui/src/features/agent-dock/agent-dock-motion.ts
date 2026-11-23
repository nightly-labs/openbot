import { LIQUID_PAD, type SpringConfig } from "../../liquid";

export const SEAT = 44;
const SEAT_GAP = 10;
export const DOCK_PAD = 10;
export const DOCK_WIDTH = SEAT + DOCK_PAD * 2;
export const PANEL_GAP = 18;
export const PANEL_WIDTH = 380;
export const PANEL_HEIGHT = 560;
export const PANEL_RADIUS = 24;
export const STAGE_WIDTH = PANEL_WIDTH + PANEL_GAP + DOCK_WIDTH;
export const DOCK_LEFT = STAGE_WIDTH - DOCK_WIDTH;
export const SEAT_CENTER_X = DOCK_LEFT + DOCK_WIDTH / 2;
const FRAME_EDGE = 5;
const PROFILE_WIDTH = 84.8;
type ProfilePoint = readonly [width: number, distance: number];
const PROFILE_START: ProfilePoint = [PROFILE_WIDTH, 0];
const PROFILE: readonly (readonly [ProfilePoint, ProfilePoint, ProfilePoint])[] = [
  [
    [84.8, 15],
    [70, 30],
    [54, 30],
  ],
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
const HANDLE_CENTER: ProfilePoint = [49.6, 80.5];
const HANDLE_RADIUS = 34.3;
export const HANDLE_STROKE = 4;

export const LIQUID_WIDTH = STAGE_WIDTH + LIQUID_PAD + 60;
export const LIQUID_HEIGHT = PANEL_HEIGHT + LIQUID_PAD * 2;

export const SEAT_PITCH = SEAT + SEAT_GAP;
const MAX_SEAT_VIEW = 8 * SEAT_PITCH + SEAT / 2;
export const SEAT_VIEW_INSET = 4;

export function seatsHeight(seats: number): number {
  return seats * SEAT_PITCH;
}

export function seatView(seats: number): number {
  return Math.min(seatsHeight(seats), MAX_SEAT_VIEW);
}

export function dockHeight(seats: number): number {
  return DOCK_PAD * 2 + seatView(seats) + SEAT;
}

export function seatViewTop(height: number): number {
  return (PANEL_HEIGHT - height) / 2 + DOCK_PAD - SEAT_VIEW_INSET;
}

export function seatCenterY(index: number, seats: number): number {
  return seatViewTop(dockHeight(seats)) + SEAT_VIEW_INSET + index * SEAT_PITCH + SEAT / 2;
}

export function addCenterY(seats: number): number {
  return seatViewTop(dockHeight(seats)) + SEAT_VIEW_INSET + seatView(seats) + SEAT / 2;
}

export function dockBand(height: number, stretch = 0) {
  const top = LIQUID_PAD + (PANEL_HEIGHT - height) / 2;
  return { top: top - Math.max(0, stretch), bottom: top + height + Math.max(0, -stretch) };
}

function profileFrame(height: number, stretch: number) {
  const { top, bottom } = dockBand(height, stretch);
  const side = LIQUID_PAD + DOCK_LEFT;
  const frame = LIQUID_PAD + STAGE_WIDTH - FRAME_EDGE;
  const scale = (frame - side) / PROFILE_WIDTH;
  const x = (width: number) => frame - width * scale;
  const up = (distance: number) => top + (BEND - distance) * scale;
  const down = (distance: number) => bottom - (BEND - distance) * scale;
  return { frame, scale, x, up, down };
}

export function dockPath(height: number, stretch = 0) {
  const { frame, x, up, down } = profileFrame(height, stretch);
  const right = LIQUID_WIDTH;
  const point = (place: (distance: number) => number, [width, distance]: ProfilePoint) =>
    `${x(width)} ${place(distance)}`;
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

function neckReach(size: number) {
  return 30 * size;
}

export function neckCenterInBand(centerY: number, size: number, height: number, stretch = 0) {
  const band = dockBand(height, stretch);
  const reach = neckReach(Math.max(0, size));
  const top = band.top - LIQUID_PAD + reach;
  const bottom = band.bottom - LIQUID_PAD - reach;
  if (top > bottom) return (top + bottom) / 2;
  return Math.min(bottom, Math.max(top, centerY));
}

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

export const STRETCH_FOLLOW: SpringConfig = { stiffness: 300, damping: 30 };
export const TUCK: SpringConfig = { stiffness: 260, damping: 22 };
export const MAX_STRETCH = 14;
export const STRETCH_PER_SPEED = 9;
export const TUCK_DISTANCE = 96;
