/** The saved width of the Browser pane. The empty side panel saves its width here too. */
export const BROWSER_PREVIEW_WIDTH_KEY = "openbot:browser-preview-panel-width";

export function readPanelWidth(key: string, fallback: number, min: number, max: number): number {
  const stored = Number.parseFloat(window.localStorage.getItem(key) ?? "");
  return Number.isFinite(stored) ? Math.min(max, Math.max(min, stored)) : fallback;
}

export function savePanelWidth(key: string, value: number) {
  window.localStorage.setItem(key, String(Math.round(value)));
}
