import type { WebContents } from "electron";

/** Chrome's largest pinch zoom on a computer. */
const MAX_PINCH_ZOOM = 5;

/** Contents that must not pinch zoom now. */
const blockedContents = new WeakSet<WebContents>();

function applyLimits(contents: WebContents): void {
  if (contents.isDestroyed()) return;
  const max = blockedContents.has(contents) ? 1 : MAX_PINCH_ZOOM;
  void contents.setVisualZoomLevelLimits(1, max).catch(() => undefined);
}

/**
 * Lets a touchpad or touch screen pinch zoom the page around the pointer, as in Chrome. Electron
 * turns pinch zoom off. A canvas, a diagram or the image viewer that zooms on a pinch cancels the
 * Ctrl+wheel event that the pinch sends, so it keeps its own zoom. The limits belong to the page's
 * renderer, and a navigation can start a new renderer, so each load sets them again.
 */
export function allowPinchZoom(contents: WebContents): void {
  applyLimits(contents);
  contents.on("did-finish-load", () => applyLimits(contents));
}

/**
 * Stops or starts pinch zoom for contents that `allowPinchZoom` set up. A native view over the page,
 * such as a browser tab, is placed from page coordinates that a pinch does not change, so the page
 * must not zoom under it. A maximum of 1 also takes back a zoom that is in effect.
 */
export function blockPinchZoom(contents: WebContents, blocked: boolean): void {
  if (blockedContents.has(contents) === blocked) return;
  if (blocked) blockedContents.add(contents);
  else blockedContents.delete(contents);
  applyLimits(contents);
}
