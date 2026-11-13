import { type SkImage, Skia } from "@shopify/react-native-skia";
import { type NativeModule, requireOptionalNativeModule } from "expo";
import { AccessibilityInfo, Appearance, AppState } from "react-native";
import { Uniwind } from "uniwind";
import { create } from "zustand";
import { useMotionPreferences } from "@/features/settings/model/motion";
import { isIOS } from "@/shared/lib/platform";

/**
 * A theme change as on desktop (`src/renderer/src/theme-sweep.ts`): a soft wash of brand colors moves
 * across the screen and the new theme comes in after it. A change from dark to light goes down from the
 * top; other changes go up from the bottom.
 *
 * A picture of the screen holds the old theme. `ThemeSweep` draws it over the app, the theme changes
 * under it, and then the picture opens from the wash front. The native module copies the window
 * pixels: iOS presents sheets outside the React Native views, and a redraw of the views on Android
 * misplaces the sheet and some text.
 *
 * With reduced motion, in the background, or without a picture, the theme changes at once.
 */

declare class ThemeSnapshotModule extends NativeModule {
  /** A JPEG picture of the whole window, sheets included. */
  snapshot(): Promise<Uint8Array>;
}

/** `modules/theme-snapshot`. A build without it, such as an older binary, changes the theme at once. */
const native = requireOptionalNativeModule<ThemeSnapshotModule>("OpenBotThemeSnapshot");

export const useThemeSweep = create<{
  /** The old theme, while a sweep is on screen. */
  image: SkImage | null;
  /** True when the sweep goes down from the top. */
  down: boolean;
  /** False while the picture covers the change, true while it opens. */
  running: boolean;
}>(() => ({ image: null, down: false, running: false }));

/** How long a frame of the picture can take to show before the change goes on without it. */
const SHOW_TIMEOUT_MS = 500;

/**
 * On iOS the theme picker is a SwiftUI menu, which closes with an animation after the choice and sends
 * no close event. The picture waits for it, or it shows the closing menu over the new theme.
 */
const MENU_CLOSE_MS = 400;

/** How long a change to "system" waits for the system theme. */
const SYSTEM_CHANGE_TIMEOUT_MS = 400;

let shown: (() => void) | undefined;

/** `ThemeSweep` calls this when the picture is on screen. */
export function reportThemeSweepShown(): void {
  shown?.();
  shown = undefined;
}

/**
 * Removes the picture. `ThemeSweep` calls this when the sweep ends. The canvas draws the picture on
 * the UI thread until it unmounts, so the canvas frees the picture, not this function.
 */
export function endThemeSweep(): void {
  useThemeSweep.setState({ image: null, running: false });
}

function nextFrame(): Promise<void> {
  return new Promise((resolve) => requestAnimationFrame(() => resolve()));
}

async function canAnimate(): Promise<boolean> {
  if (AppState.currentState !== "active" || !useMotionPreferences.getState().allAnimations) return false;
  return !(await AccessibilityInfo.isReduceMotionEnabled().catch(() => true));
}

async function capture(): Promise<SkImage | null> {
  if (!native) return null;
  const data = Skia.Data.fromBytes(await native.snapshot());
  try {
    return Skia.Image.MakeImageFromEncoded(data);
  } finally {
    data.dispose();
  }
}

/** Runs `apply`, which changes the theme, behind a wash that moves across the screen. */
export async function sweepTheme(apply: () => void): Promise<void> {
  // A newer change ends the sweep on screen. The new picture must not show it, so the old canvas
  // leaves the screen first.
  const previous = useThemeSweep.getState().image !== null;
  endThemeSweep();
  shown?.();
  if (previous) {
    await nextFrame();
    await nextFrame();
  }
  if (!(await canAnimate())) {
    apply();
    return;
  }
  if (isIOS) await new Promise((resolve) => setTimeout(resolve, MENU_CLOSE_MS));
  const image = await capture().catch(() => null);
  if (!image) {
    apply();
    return;
  }
  const before = Uniwind.currentTheme;
  await new Promise<void>((resolve) => {
    const timer = setTimeout(resolve, SHOW_TIMEOUT_MS);
    shown = () => {
      clearTimeout(timer);
      resolve();
    };
    useThemeSweep.setState({ image, down: false, running: false });
  });
  try {
    apply();
  } catch (error) {
    if (useThemeSweep.getState().image === image) endThemeSweep();
    throw error;
  }
  // "System" removes the light or dark override, and the system theme comes later as an `Appearance`
  // change. Uniwind listens first, so its theme is current when this listener runs. A system theme
  // that is the same as before sends no change.
  if (Uniwind.currentTheme === before) {
    await new Promise<void>((resolve) => {
      const timer = setTimeout(done, SYSTEM_CHANGE_TIMEOUT_MS);
      const subscription = Appearance.addChangeListener(done);
      function done() {
        clearTimeout(timer);
        subscription.remove();
        resolve();
      }
    });
  }
  const after = Uniwind.currentTheme;
  // A newer change has already removed this picture.
  if (useThemeSweep.getState().image !== image) return;
  if (after === before) endThemeSweep();
  else useThemeSweep.setState({ down: before === "dark" && after === "light", running: true });
}
