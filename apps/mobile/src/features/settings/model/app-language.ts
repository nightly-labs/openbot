import { type AppLanguage, DEFAULT_APP_LANGUAGE, isAppLanguage } from "@openbot/i18n/mobile";
import * as SecureStore from "expo-secure-store";
import { create } from "zustand";

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
    if (isAppLanguage(stored) && !useAppLanguage.getState().ready) useAppLanguage.setState({ value: stored });
  } finally {
    useAppLanguage.setState({ ready: true });
  }
}

export async function saveAppLanguage(value: AppLanguage): Promise<void> {
  if (!useAppLanguage.getState().ready || useAppLanguage.getState().saving) return;
  useAppLanguage.setState({ value, saving: true });
  try {
    await SecureStore.setItemAsync(key, value);
  } finally {
    useAppLanguage.setState({ saving: false });
  }
}
