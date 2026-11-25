import type { BrowserBounds } from "@openbot/contracts/ipc";

export const BROWSER_PIP_STORAGE_KEY = "openbot:browser-pip-native-bounds";
export const BROWSER_WINDOW_STORAGE_KEY = "openbot:browser-window-bounds";

export function readStoredBounds(key: string): BrowserBounds | null {
  const values = (window.localStorage.getItem(key) ?? "").split(",").map((value) => Number.parseFloat(value));
  const [x = Number.NaN, y = Number.NaN, width = Number.NaN, height = Number.NaN] = values;
  return values.length === 4 && [x, y, width, height].every(Number.isFinite) ? { x, y, width, height } : null;
}

export function storeBounds(key: string, bounds: BrowserBounds) {
  try {
    window.localStorage.setItem(key, [bounds.x, bounds.y, bounds.width, bounds.height].join(","));
  } catch {
    return;
  }
}
