import { beforeEach, expect, it, vi } from "vitest";
import { loadAppLanguage, saveAppLanguage, useAppLanguage } from "./app-language";

// Device storage is the integration boundary.
const native = vi.hoisted(() => {
  const storage: { stored: string | null } = { stored: null };
  return storage;
});
vi.mock("expo-secure-store", () => ({
  getItemAsync: async () => native.stored,
  setItemAsync: async (_key: string, value: string) => {
    native.stored = value;
  },
}));
beforeEach(() => {
  native.stored = null;
  useAppLanguage.setState({ value: "system", ready: false, saving: false });
});

it("restores the chosen language after restart", async () => {
  await loadAppLanguage();
  await saveAppLanguage("ja");
  useAppLanguage.setState({ value: "system", ready: false });
  await loadAppLanguage();
  expect(useAppLanguage.getState().value).toBe("ja");
});

it("ignores a stored language this build does not ship", async () => {
  native.stored = "pl";
  await loadAppLanguage();
  expect(useAppLanguage.getState()).toMatchObject({ value: "system", ready: true });
});
