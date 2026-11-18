import { type AppInterfaceSize, DEFAULT_APP_INTERFACE_SIZE } from "@openbot/contracts/ipc";
import { create } from "zustand";

/**
 * The text size of the app, as a percent, in the steps of the desktop interface size. Each text and
 * text field multiplies its size by it, on top of the text size in the phone settings.
 *
 * This module must not import `react-native`: the scaled text shim reads it while the `react-native`
 * components load.
 */
export const useTextSize = create<{ percent: AppInterfaceSize; ready: boolean }>(() => ({
  percent: DEFAULT_APP_INTERFACE_SIZE,
  ready: false,
}));

/** The text size as a multiplier, for native text that the React Native `Text` does not draw. */
export function useTextScale(): number {
  return useTextSize((state) => state.percent) / 100;
}
