import * as SecureStore from "expo-secure-store";
import { Uniwind } from "uniwind";
import { create } from "zustand";
import { sweepTheme } from "@/features/settings/model/theme-sweep";

export type Appearance = "system" | "light" | "dark";
const key = "openbot.mobile.appearance.v1";
export const useAppearance = create<{ value: Appearance; ready: boolean; saving: boolean }>(() => ({
  value: "system",
  ready: false,
  saving: false,
}));

export async function loadAppearance(): Promise<void> {
  try {
    const stored = await SecureStore.getItemAsync(key);
    const value = stored === "light" || stored === "dark" ? stored : "system";
    Uniwind.setTheme(value);
    useAppearance.setState({ value });
  } finally {
    useAppearance.setState({ ready: true });
  }
}

export async function saveAppearance(value: Appearance): Promise<void> {
  if (!useAppearance.getState().ready || useAppearance.getState().saving) return;
  useAppearance.setState({ saving: true });
  try {
    await SecureStore.setItemAsync(key, value);
    const apply = () => {
      Uniwind.setTheme(value);
      useAppearance.setState({ value });
    };
    // A light or dark choice that the screen already shows has nothing to animate. "System" can
    // only tell its theme after the change.
    if (value !== "system" && value === Uniwind.currentTheme) apply();
    else await sweepTheme(apply);
  } finally {
    useAppearance.setState({ saving: false });
  }
}
