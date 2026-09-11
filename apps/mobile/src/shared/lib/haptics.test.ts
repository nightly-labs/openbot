import { beforeEach, expect, it, vi } from "vitest";
import {
  loadHapticsPreference,
  saveHapticsPreference,
  useHapticsPreference,
} from "../../features/settings/model/haptics";
import { haptics } from "./haptics";

const native = vi.hoisted(() => {
  const storage: { stored: string | null } = { stored: null };
  return {
    ...storage,
    read: vi.fn<() => Promise<string | null>>(),
    write: vi.fn<(_key: string, value: string) => Promise<void>>(),
    feedback: vi.fn<(...args: string[]) => Promise<void>>(),
  };
});
// Native storage and feedback have no injectable interface.
vi.mock("expo-secure-store", () => ({ getItemAsync: native.read, setItemAsync: native.write }));
vi.mock("expo-haptics", () => ({
  selectionAsync: () => native.feedback("selection"),
  impactAsync: (style: string) => native.feedback("impact", style),
  notificationAsync: (type: string) => native.feedback("notification", type),
  ImpactFeedbackStyle: { Light: "light", Medium: "medium", Heavy: "heavy", Soft: "soft", Rigid: "rigid" },
  NotificationFeedbackType: { Success: "success", Warning: "warning", Error: "error" },
}));

beforeEach(() => {
  native.stored = null;
  native.read.mockReset().mockImplementation(async () => native.stored);
  native.write.mockReset().mockImplementation(async (_key, value) => {
    native.stored = value;
  });
  native.feedback.mockReset().mockResolvedValue(undefined);
  useHapticsPreference.setState({ enabled: false, ready: false, saving: false });
});

it("waits for the preference and enables feedback by default", async () => {
  await haptics.selection();
  expect(native.feedback).not.toHaveBeenCalled();
  await loadHapticsPreference();
  await haptics.selection();
  expect(native.feedback).toHaveBeenCalledWith("selection");
});

it("disables every feedback event immediately and restores the preference after restart", async () => {
  await loadHapticsPreference();
  let finishWrite = () => {};
  native.write.mockImplementationOnce(
    (_key, value) =>
      new Promise<void>((resolve) => {
        finishWrite = () => {
          native.stored = value;
          resolve();
        };
      }),
  );
  const saving = saveHapticsPreference(false);
  await haptics.selection();
  await haptics.impact();
  await haptics.notification();
  expect(native.feedback).not.toHaveBeenCalled();
  finishWrite();
  await saving;
  useHapticsPreference.setState({ enabled: true, ready: false });
  await loadHapticsPreference();
  await haptics.impact();
  expect(native.feedback).not.toHaveBeenCalled();
  await saveHapticsPreference(true);
  useHapticsPreference.setState({ enabled: false, ready: false });
  await loadHapticsPreference();
  await haptics.notification();
  expect(native.feedback).toHaveBeenCalledWith("notification", "success");
});

it.each(["light", "medium", "heavy", "soft", "rigid"] as const)("plays the requested %s impact", async (style) => {
  await loadHapticsPreference();
  await haptics.impact(style);
  expect(native.feedback).toHaveBeenCalledWith("impact", style);
});

it.each(["success", "warning", "error"] as const)("plays the requested %s notification", async (type) => {
  await loadHapticsPreference();
  await haptics.notification(type);
  expect(native.feedback).toHaveBeenCalledWith("notification", type);
});

it("keeps feedback off on a read failure and permits saving a new preference", async () => {
  native.read.mockRejectedValueOnce(new Error("Storage unavailable"));
  await expect(loadHapticsPreference()).rejects.toThrow("Storage unavailable");
  await haptics.selection();
  expect(native.feedback).not.toHaveBeenCalled();
  await saveHapticsPreference(true);
  await haptics.selection();
  expect(native.feedback).toHaveBeenCalledWith("selection");
});

it("keeps feedback disabled if saving fails and permits retry", async () => {
  await loadHapticsPreference();
  native.write.mockRejectedValueOnce(new Error("Storage unavailable"));
  await expect(saveHapticsPreference(false)).rejects.toThrow("Storage unavailable");
  await haptics.selection();
  expect(native.feedback).not.toHaveBeenCalled();
  await saveHapticsPreference(false);
  expect(native.stored).toBe("false");
});

it("ignores a startup read that completes after the user changes the setting", async () => {
  let finishRead = (_value: string | null) => {};
  native.read.mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        finishRead = resolve;
      }),
  );
  const pending = loadHapticsPreference();
  await loadHapticsPreference();
  await saveHapticsPreference(false);
  finishRead(null);
  await pending;
  await haptics.selection();
  expect(native.feedback).not.toHaveBeenCalled();
});

it("does not let unavailable native feedback interrupt an action", async () => {
  await loadHapticsPreference();
  native.feedback.mockRejectedValueOnce(new Error("Not available"));
  await expect(haptics.impact()).resolves.toBeUndefined();
  native.feedback.mockImplementationOnce(() => {
    throw new Error("Missing native module");
  });
  await expect(haptics.notification()).resolves.toBeUndefined();
});
