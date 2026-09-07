import * as SecureStore from "expo-secure-store";
import { Uniwind } from "uniwind";
import { create } from "zustand";

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
    Uniwind.setTheme(value);
    useAppearance.setState({ value });
  } finally {
    useAppearance.setState({ saving: false });
  }
}
