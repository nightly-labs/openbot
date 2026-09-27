// The camera of the channel shot, as a pure function of `t`. It starts zoomed in on the opening
// message, tilted, and springs back to the whole panel. The hook and the channel both use it, and
// the canvas effects use `project` to follow the panel while the camera moves.

import { ease, keys, lerp, spring } from "../timeline";
import { CUE, TURNS } from "./cues";

/** The panel at rest, in stage pixels. The shot layer's coordinates are the same. */
export const PANEL = { x: 960, y: 548, width: 1240, height: 920 } as const;
export const PANEL_LEFT = PANEL.x - PANEL.width / 2;
export const PANEL_TOP = PANEL.y - PANEL.height / 2;
export const ROW = { top: 180, height: 142, avatar: 88, text: 180 } as const;

/** The opening message, at rest. The camera starts on it. */
export const BUBBLE = { x: 960, top: 236, font: 44, line: 48, label: 50, padding: 30 } as const;
const HOOK_ZOOM = 3.6;
const HOOK_TILT = -5;

export function bubbleHeight(lines: number): number {
  return BUBBLE.label + lines * BUBBLE.line + BUBBLE.padding;
}

/** The bubble grows one line at a time, so the camera follows its middle. */
export function bubbleLines(t: number): number {
  return keys(
    t,
    [
      [0, 1],
      [CUE.line2, 2],
      [CUE.mention, 3],
    ],
    0.12,
    ease.outExpo,
  );
}

export interface Camera {
  zoom: number;
  rotate: number;
  focusX: number;
  focusY: number;
}

/** During the handoffs the camera leans in on each new message, and backs off for the stamp. */
const FOLLOW_ZOOM = 1.07;
const FOLLOW: readonly (readonly [number, number])[] = [
  [0, 540],
  ...TURNS.map((turn, index) => [turn.message, PANEL_TOP + ROW.top + (index + 1) * ROW.height + 20] as const),
  [CUE.shipped, 540],
];

function follow(t: number): { zoom: number; focusY: number } {
  const first = TURNS[0]?.message ?? 0;
  const zoom = keys(
    t,
    [
      [0, 1],
      [first, FOLLOW_ZOOM],
      [CUE.shipped, 1],
    ],
    0.35,
    ease.outExpo,
  );
  // The focus moves only part of the way to the row, and never so far that the header leaves
  // the frame.
  const lowest = PANEL_TOP + (540 - 24) / FOLLOW_ZOOM;
  const focusY = Math.min(lowest, lerp(540, keys(t, FOLLOW, 0.35, ease.outExpo), 0.45));
  return { zoom, focusY };
}

export function camera(t: number): Camera {
  const focusY = BUBBLE.top + bubbleHeight(bubbleLines(t)) / 2;
  const push = HOOK_ZOOM * (1 + 0.05 * Math.min(t, CUE.pull));
  const back = spring(t, CUE.pull, 1.5, 0.62);
  const lean = follow(t);
  return {
    zoom: Math.exp(lerp(Math.log(push), 0, back)) * lean.zoom,
    rotate: lerp(HOOK_TILT, 0, back),
    focusX: lerp(BUBBLE.x, 960, back),
    focusY: lerp(focusY, lean.focusY, back),
  };
}

export function cameraTransform(t: number): string {
  const { zoom, rotate, focusX, focusY } = camera(t);
  return `translate(960px, 540px) rotate(${rotate}deg) scale(${zoom}) translate(${-focusX}px, ${-focusY}px)`;
}

/** Where a point of the shot layer is on the stage at `t`. */
export function project(x: number, y: number, t: number): { x: number; y: number } {
  const { zoom, rotate, focusX, focusY } = camera(t);
  const angle = (rotate * Math.PI) / 180;
  const dx = (x - focusX) * zoom;
  const dy = (y - focusY) * zoom;
  return {
    x: 960 + dx * Math.cos(angle) - dy * Math.sin(angle),
    y: 540 + dx * Math.sin(angle) + dy * Math.cos(angle),
  };
}

/** The middle of row `index`'s avatar, in shot coordinates. */
export function rowAvatar(index: number): { x: number; y: number } {
  return {
    x: PANEL_LEFT + 64 + ROW.avatar / 2,
    y: PANEL_TOP + ROW.top + index * ROW.height + ROW.avatar / 2,
  };
}
