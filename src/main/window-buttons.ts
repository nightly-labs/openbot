import { IPC_ENDPOINTS, type WindowFrameState } from "@openbot/contracts/ipc";
import type { LayoutDirection } from "@openbot/i18n";
import { app, type BrowserWindow, type BrowserWindowConstructorOptions } from "electron";
import { sendToRenderer } from "./renderer-ipc";

export const WINDOW_BUTTON_INSET = { x: 12, y: 13 } as const;
const WINDOW_BUTTON_GROUP_WIDTH = 59;

const RIGHT_TO_LEFT_LANGUAGES: ReadonlySet<string> = new Set(["ar", "fa", "he", "iw", "ps", "sd", "ug", "ur", "yi"]);

export const DRAWS_OWN_WINDOW_BUTTONS = process.platform === "win32";

export function windowButtonOptions(): BrowserWindowConstructorOptions {
  if (process.platform === "darwin") return { titleBarStyle: "hidden", trafficLightPosition: WINDOW_BUTTON_INSET };
  if (DRAWS_OWN_WINDOW_BUTTONS) return { titleBarStyle: "hidden" };
  return {};
}

export function windowFrameState(window: Pick<BrowserWindow, "isMaximized">): WindowFrameState {
  return { buttons: DRAWS_OWN_WINDOW_BUTTONS, maximized: window.isMaximized() };
}

export function followWindowFrameState(window: BrowserWindow): void {
  if (!DRAWS_OWN_WINDOW_BUTTONS) return;
  const send = () => sendToRenderer(window, IPC_ENDPOINTS.windowFrame.state, windowFrameState(window));
  window.on("maximize", send);
  window.on("unmaximize", send);
}

const placements = new WeakMap<BrowserWindow, () => void>();

function chromiumDirection(): LayoutDirection {
  const language = app.getLocale().split("-")[0]?.toLowerCase() ?? "";
  return RIGHT_TO_LEFT_LANGUAGES.has(language) ? "rtl" : "ltr";
}

export function followWindowButtonSide(window: BrowserWindow, direction: () => LayoutDirection): void {
  if (process.platform !== "darwin") return;
  let mirrored = false;
  const place = (): void => {
    if (window.isDestroyed()) return;
    const mirror = direction() !== chromiumDirection();
    if (!mirror && !mirrored) return;
    mirrored = mirror;
    const x = mirror
      ? window.getBounds().width - WINDOW_BUTTON_INSET.x - WINDOW_BUTTON_GROUP_WIDTH
      : WINDOW_BUTTON_INSET.x;
    window.setWindowButtonPosition({ x, y: WINDOW_BUTTON_INSET.y });
  };
  placements.set(window, place);
  window.on("resize", place);
  place();
}

export function placeWindowButtons(windows: readonly BrowserWindow[]): void {
  for (const window of windows) placements.get(window)?.();
}
