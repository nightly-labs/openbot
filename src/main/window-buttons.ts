import type { LayoutDirection } from "@openbot/i18n";
import { app, type BrowserWindow } from "electron";

/**
 * The macOS window buttons sit at the inline start of the page: the top left in a left-to-right
 * language and the top right in Arabic, as in other Arabic macOS apps. The renderer keeps its top
 * row clear of them with `padding-inline-start`.
 *
 * AppKit puts the buttons on the right only when Chromium's own locale is right to left, and Chromium
 * reads its locale once, at launch. The app language can change while the app runs, and it can have
 * the other direction from the system. Then the buttons are measured from the far edge, again after
 * each resize, because `setWindowButtonPosition` counts from the edge that AppKit starts at.
 */

/** The offset of the button group from the top corner, as in every window with these buttons. */
export const WINDOW_BUTTON_INSET = { x: 12, y: 13 } as const;
/** macOS spaces the three 13px buttons 23px apart, so the group is 59px wide. */
const WINDOW_BUTTON_GROUP_WIDTH = 59;

/** Chromium's right-to-left interface languages. */
const RIGHT_TO_LEFT_LANGUAGES: ReadonlySet<string> = new Set(["ar", "fa", "he", "iw", "ps", "sd", "ug", "ur", "yi"]);

const placements = new WeakMap<BrowserWindow, () => void>();

function chromiumDirection(): LayoutDirection {
  const language = app.getLocale().split("-")[0]?.toLowerCase() ?? "";
  return RIGHT_TO_LEFT_LANGUAGES.has(language) ? "rtl" : "ltr";
}

/** Keeps the buttons of `window` at the inline start of `direction()`. No effect outside macOS. */
export function followWindowButtonSide(window: BrowserWindow, direction: () => LayoutDirection): void {
  if (process.platform !== "darwin") return;
  let mirrored = false;
  const place = (): void => {
    if (window.isDestroyed()) return;
    const mirror = direction() !== chromiumDirection();
    // A window that was never moved keeps the position it was made with, and needs no call per resize.
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

/** Moves the buttons of every followed window after a change of the app language. */
export function placeWindowButtons(windows: readonly BrowserWindow[]): void {
  for (const window of windows) placements.get(window)?.();
}
