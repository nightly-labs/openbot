import { beforeEach, expect, it, vi } from "vitest";
import {
  AUTOMATIC_DICTATION_LANGUAGE,
  loadDictationLanguage,
  saveDictationLanguage,
  useDictationLanguage,
} from "./dictation-language";

// Device storage is the integration boundary.
const native = vi.hoisted(() => {
  const storage: { stored: string | null; fail: boolean } = { stored: null, fail: false };
  return storage;
});
vi.mock("expo-secure-store", () => ({
  getItemAsync: async () => native.stored,
  setItemAsync: async (_key: string, value: string) => {
    if (native.fail) throw new Error("Storage unavailable");
    native.stored = value;
  },
}));
beforeEach(() => {
  native.stored = null;
  native.fail = false;
  useDictationLanguage.setState({ value: AUTOMATIC_DICTATION_LANGUAGE, ready: false, saving: false });
});

it("starts on automatic and restores the chosen language after restart", async () => {
  await loadDictationLanguage();
  expect(useDictationLanguage.getState().value).toBe(AUTOMATIC_DICTATION_LANGUAGE);
  await saveDictationLanguage("pl-PL");
  useDictationLanguage.setState({ value: AUTOMATIC_DICTATION_LANGUAGE, ready: false });
  await loadDictationLanguage();
  expect(useDictationLanguage.getState().value).toBe("pl-PL");
});

it("keeps the choice for this session when storage fails, and a retry stores it", async () => {
  await loadDictationLanguage();
  native.fail = true;
  await expect(saveDictationLanguage("pl-PL")).rejects.toThrow("Storage unavailable");
  expect(useDictationLanguage.getState()).toMatchObject({ value: "pl-PL", saving: false });
  native.fail = false;
  await saveDictationLanguage("pl-PL");
  expect(native.stored).toBe("pl-PL");
});
