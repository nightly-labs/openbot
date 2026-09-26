import { type AppLanguage, DEFAULT_APP_LANGUAGE, isAppLanguage } from "@openbot/i18n/mobile";
import * as SecureStore from "expo-secure-store";
import { create } from "zustand";

/**
 * The interface language on this phone. `"system"` follows the phone's first language. The desktop
 * keeps its own setting: a phone and a computer can read in different languages.
 */
const key = "openbot.mobile.app-language.v1";
export const useAppLanguage = create<{ value: AppLanguage; ready: boolean; saving: boolean }>(() => ({
  value: DEFAULT_APP_LANGUAGE,
  ready: false,
  saving: false,
}));

export async function loadAppLanguage(): Promise<void> {
  if (useAppLanguage.getState().ready) return;
  try {
    const stored = await SecureStore.getItemAsync(key);
    // A value from a newer build that ships a language this one does not is ignored, not shown.
    // A second startup read must not overwrite a change made in Settings.
    if (isAppLanguage(stored) && !useAppLanguage.getState().ready) useAppLanguage.setState({ value: stored });
  } finally {
    useAppLanguage.setState({ ready: true });
  }
}

export async function saveAppLanguage(value: AppLanguage): Promise<void> {
  if (!useAppLanguage.getState().ready || useAppLanguage.getState().saving) return;
  // Apply immediately, including when storage fails. Settings offers a retry.
  useAppLanguage.setState({ value, saving: true });
  try {
    await SecureStore.setItemAsync(key, value);
  } finally {
    useAppLanguage.setState({ saving: false });
  }
}
