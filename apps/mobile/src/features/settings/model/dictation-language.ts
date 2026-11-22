import * as SecureStore from "expo-secure-store";
import { create } from "zustand";

export const AUTOMATIC_DICTATION_LANGUAGE = "automatic";

const key = "openbot.mobile.dictation-language.v1";
export const useDictationLanguage = create<{ value: string; ready: boolean; saving: boolean }>(() => ({
  value: AUTOMATIC_DICTATION_LANGUAGE,
  ready: false,
  saving: false,
}));

export async function loadDictationLanguage(): Promise<void> {
  if (useDictationLanguage.getState().ready) return;
  try {
    const stored = await SecureStore.getItemAsync(key);
    if (stored && !useDictationLanguage.getState().ready) useDictationLanguage.setState({ value: stored });
  } finally {
    useDictationLanguage.setState({ ready: true });
  }
}

export async function saveDictationLanguage(value: string): Promise<void> {
  if (!useDictationLanguage.getState().ready || useDictationLanguage.getState().saving) return;
  useDictationLanguage.setState({ value, saving: true });
  try {
    await SecureStore.setItemAsync(key, value);
  } finally {
    useDictationLanguage.setState({ saving: false });
  }
}
