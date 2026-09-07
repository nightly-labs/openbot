import { beforeEach, expect, it, vi } from "vitest";
import { loadAppearance, saveAppearance, useAppearance } from "./appearance";

// Device storage and the native theme runtime are the integration boundary.
const native = vi.hoisted(() => {
  const storage: { stored: string | null; fail: boolean } = { stored: null, fail: false };
  return { ...storage, setTheme: vi.fn() };
});
vi.mock("expo-secure-store", () => ({
  getItemAsync: async () => native.stored,
  setItemAsync: async (_key: string, value: string) => {
    if (native.fail) throw new Error("Storage unavailable");
    native.stored = value;
  },
}));
vi.mock("uniwind", () => ({ Uniwind: { setTheme: native.setTheme } }));
beforeEach(() => {
  native.stored = null;
  native.fail = false;
  native.setTheme.mockClear();
  useAppearance.setState({ value: "system", ready: false, saving: false });
});
it("restores the chosen appearance after restart and can return to system", async () => {
  await loadAppearance();
  await saveAppearance("dark");
  useAppearance.setState({ value: "system", ready: false });
  await loadAppearance();
  expect(useAppearance.getState().value).toBe("dark");
  expect(native.setTheme).toHaveBeenLastCalledWith("dark");
  await saveAppearance("system");
  await loadAppearance();
  expect(useAppearance.getState().value).toBe("system");
  expect(native.setTheme).toHaveBeenLastCalledWith("system");
});
it("keeps the previous appearance on storage failure and permits retry", async () => {
  await loadAppearance();
  native.fail = true;
  await expect(saveAppearance("light")).rejects.toThrow("Storage unavailable");
  expect(useAppearance.getState().value).toBe("system");
  native.fail = false;
  await saveAppearance("light");
  expect(native.stored).toBe("light");
});
