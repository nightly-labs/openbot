// The device and the camera, as pure functions of `t`. One device changes from the desktop app to a
// browser to an iPhone, and the chat column stays the anchor. The scenes place their parts from
// `layout`, and the canvas effects use `project` to follow the device while the camera moves.

import { clamp, decay, ease, lerp, progress, spring } from "../timeline";
import { CUE } from "./cues";

const DESKTOP = { y: 612, width: 1380, height: 780, radius: 18 } as const;
const BROWSER = { y: 612, width: 1440, height: 800, radius: 18 } as const;
/** The iPhone, at the 393 x 852 point ratio. The app text is larger than on a real phone, to read. */
const PHONE = { y: 616, width: 380, height: 824, radius: 64 } as const;

export const RAIL = 88;
export const SIDEBAR = 340;
export const TAB_STRIP = 48;
export const TOOLBAR = 56;
const STATUS_BAR = 58;
const COLUMN = 640;
/** The reply and the task card are indented by the avatar and its gap. */
export const INDENT = 54;
export const CARD = { header: 56, row: 46, bottom: 14 } as const;
export const COMPOSER_HEIGHT = 60;

export interface Pose {
  /** Center and size, in shot pixels. */
  x: number;
  y: number;
  width: number;
  height: number;
  radius: number;
  /** 0 the desktop window, 1 the browser. */
  browser: number;
  /** 0 a computer, 1 the iPhone. */
  phone: number;
  /** 0 in the app, 1 on the home screen. */
  home: number;
  /** 0 to 1 while the phone flies into the logo. */
  fly: number;
}

export function devicePose(t: number): Pose {
  const browser = ease.outExpo(progress(t, CUE.browser, 0.4));
  const phone = ease.logo(progress(t, CUE.phone, CUE.phoneDone - CUE.phone));
  const computer = {
    y: lerp(DESKTOP.y, BROWSER.y, browser),
    width: lerp(DESKTOP.width, BROWSER.width, browser),
    height: lerp(DESKTOP.height, BROWSER.height, browser),
    radius: DESKTOP.radius,
  };
  return {
    x: 960,
    y: lerp(computer.y, PHONE.y, phone),
    width: lerp(computer.width, PHONE.width, phone),
    height: lerp(computer.height, PHONE.height, phone),
    radius: lerp(computer.radius, PHONE.radius, phone),
    browser,
    phone,
    home: ease.inOutCubic(progress(t, CUE.home, 0.45)),
    fly: ease.inCubic(progress(t, CUE.fly, CUE.logo - CUE.fly)),
  };
}

/** Where the parts are, in pixels from the device's top left corner. */
export interface Layout {
  /** The height of the browser's tab strip and toolbar. */
  chrome: number;
  rail: number;
  sidebar: number;
  paneX: number;
  paneWidth: number;
  /** The top of the pane's content, under the browser chrome or the phone's status bar. */
  top: number;
  columnX: number;
  columnWidth: number;
  bubbleY: number;
  replyY: number;
  cardX: number;
  cardY: number;
  cardWidth: number;
  composerY: number;
}

export function layout(pose: Pose): Layout {
  const computer = 1 - pose.phone;
  const chrome = (TAB_STRIP + TOOLBAR) * pose.browser * computer;
  const rail = RAIL * computer;
  const sidebar = SIDEBAR * computer;
  const paneX = rail + sidebar;
  const paneWidth = pose.width - paneX;
  const top = chrome + STATUS_BAR * pose.phone;
  const columnWidth = Math.min(COLUMN, paneWidth - 2 * lerp(48, 17, pose.phone));
  const columnX = paneX + (paneWidth - columnWidth) / 2;
  const bubbleY = top + 96;
  const replyY = bubbleY + 80;
  return {
    chrome,
    rail,
    sidebar,
    paneX,
    paneWidth,
    top,
    columnX,
    columnWidth,
    bubbleY,
    replyY,
    cardX: columnX + INDENT,
    cardY: replyY + 70,
    cardWidth: columnWidth - INDENT,
    composerY: pose.height - lerp(84, 92, pose.phone),
  };
}

/** The middle of task `index`'s check circle, in device pixels. */
export function taskCheck(parts: Layout, index: number): { x: number; y: number } {
  return { x: parts.cardX + 32, y: parts.cardY + CARD.header + (index + 0.5) * CARD.row };
}

/** A device point in shot pixels. The fly-out is not included: nothing is measured during it. */
export function onDevice(pose: Pose, x: number, y: number): { x: number; y: number } {
  return { x: pose.x - pose.width / 2 + x, y: pose.y - pose.height / 2 + y };
}

export interface Camera {
  zoom: number;
  rotate: number;
  focusX: number;
  focusY: number;
}

const HOOK_ZOOM = 3.1;
const HOOK_TILT = -5;
/** The typed request in the composer, at rest: the middle of its text, in shot pixels. */
const HOOK_FOCUS = (() => {
  const pose = devicePose(0);
  const parts = layout(pose);
  return onDevice(pose, parts.columnX + 24 + 104, parts.composerY + COMPOSER_HEIGHT / 2);
})();
const ISLAND_ZOOM = 1.75;
/** Under the island, so that the expanded island and the icons under it are in the frame. */
const ISLAND_FOCUS_Y = PHONE.y - PHONE.height / 2 + 150;

export function camera(t: number): Camera {
  const push = HOOK_ZOOM * (1 + 0.05 * Math.min(t, CUE.send));
  const back = spring(t, CUE.send, 1.5, 0.62);
  // Back to the full frame when the logo lands, so that the phone flies to the logo's center.
  const island =
    ease.inOutCubic(progress(t, CUE.home, 0.6)) *
    (1 - ease.inOutCubic(progress(t, CUE.fly - 0.15, CUE.logo - CUE.fly + 0.15)));
  // The cuts to the browser and the phone push the camera in a little.
  const kick = 0.05 * decay(t, CUE.browser, 0.5) + 0.04 * decay(t, CUE.phone, 0.5);
  return {
    zoom: Math.exp(lerp(Math.log(push), 0, back)) * lerp(1, ISLAND_ZOOM, island) * (1 + kick),
    rotate: lerp(HOOK_TILT, 0, back) + 1.5 * island * (1 - clamp(progress(t, CUE.expand, 0.8))),
    focusX: lerp(HOOK_FOCUS.x, 960, back),
    focusY: lerp(HOOK_FOCUS.y, lerp(540, ISLAND_FOCUS_Y, island), back),
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
