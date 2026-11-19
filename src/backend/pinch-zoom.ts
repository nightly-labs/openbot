import type { WebContents } from "electron";

const MAX_PINCH_ZOOM = 5;

const blockedContents = new WeakSet<WebContents>();

function applyLimits(contents: WebContents): void {
  if (contents.isDestroyed()) return;
  const max = blockedContents.has(contents) ? 1 : MAX_PINCH_ZOOM;
  void contents.setVisualZoomLevelLimits(1, max).catch(() => undefined);
}

export function allowPinchZoom(contents: WebContents): void {
  applyLimits(contents);
  contents.on("did-finish-load", () => applyLimits(contents));
}

export function blockPinchZoom(contents: WebContents, blocked: boolean): void {
  if (blockedContents.has(contents) === blocked) return;
  if (blocked) blockedContents.add(contents);
  else blockedContents.delete(contents);
  applyLimits(contents);
}
