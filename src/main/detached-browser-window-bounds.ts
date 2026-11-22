import type { BrowserBounds } from "@openbot/contracts/ipc";
import { rectanglesIntersect } from "./browser-picture-in-picture-bounds";

export const DETACHED_BROWSER_MIN_WIDTH = 480;
export const DETACHED_BROWSER_MIN_HEIGHT = 360;
const DEFAULT_WIDTH = 1200;
const DEFAULT_HEIGHT = 820;

export function detachedBrowserWindowBounds(
  savedBounds: BrowserBounds | undefined,
  mainWindowBounds: BrowserBounds,
  workAreas: readonly BrowserBounds[],
): BrowserBounds {
  const savedArea = savedBounds && workAreas.find((area) => rectanglesIntersect(savedBounds, area));
  if (savedBounds && savedArea) return fitInto(savedBounds, savedArea);
  const mainArea = workAreas.find((area) => containsCenter(area, mainWindowBounds)) ?? workAreas[0] ?? mainWindowBounds;
  const otherArea = workAreas.find((area) => area !== mainArea);
  if (otherArea) return { ...otherArea };
  const width = Math.min(mainArea.width, DEFAULT_WIDTH);
  const height = Math.min(mainArea.height, DEFAULT_HEIGHT);
  return {
    x: Math.round(mainArea.x + (mainArea.width - width) / 2),
    y: Math.round(mainArea.y + (mainArea.height - height) / 2),
    width,
    height,
  };
}

function fitInto(bounds: BrowserBounds, area: BrowserBounds): BrowserBounds {
  const width = Math.min(area.width, Math.max(DETACHED_BROWSER_MIN_WIDTH, bounds.width));
  const height = Math.min(area.height, Math.max(DETACHED_BROWSER_MIN_HEIGHT, bounds.height));
  return {
    x: Math.round(Math.min(area.x + area.width - width, Math.max(area.x, bounds.x))),
    y: Math.round(Math.min(area.y + area.height - height, Math.max(area.y, bounds.y))),
    width: Math.round(width),
    height: Math.round(height),
  };
}

function containsCenter(area: BrowserBounds, bounds: BrowserBounds): boolean {
  const x = bounds.x + bounds.width / 2;
  const y = bounds.y + bounds.height / 2;
  return x >= area.x && x <= area.x + area.width && y >= area.y && y <= area.y + area.height;
}
