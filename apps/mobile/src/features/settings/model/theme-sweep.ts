import { type SkImage, Skia } from "@shopify/react-native-skia";
import { type NativeModule, requireOptionalNativeModule } from "expo";
import { AccessibilityInfo, Appearance, AppState } from "react-native";
import { Uniwind } from "uniwind";
import { create } from "zustand";
import { useMotionPreferences } from "@/features/settings/model/motion";
import { isIOS } from "@/shared/lib/platform";

declare class ThemeSnapshotModule extends NativeModule {
  snapshot(): Promise<Uint8Array>;
}

const native = requireOptionalNativeModule<ThemeSnapshotModule>("OpenBotThemeSnapshot");

export const useThemeSweep = create<{
  image: SkImage | null;
  down: boolean;
  running: boolean;
}>(() => ({ image: null, down: false, running: false }));

const SHOW_TIMEOUT_MS = 500;

const MENU_CLOSE_MS = 400;

const SYSTEM_CHANGE_TIMEOUT_MS = 400;

let shown: (() => void) | undefined;

export function reportThemeSweepShown(): void {
  shown?.();
  shown = undefined;
}

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

export async function sweepTheme(apply: () => void): Promise<void> {
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
  if (useThemeSweep.getState().image !== image) return;
  if (after === before) endThemeSweep();
  else useThemeSweep.setState({ down: before === "dark" && after === "light", running: true });
}
