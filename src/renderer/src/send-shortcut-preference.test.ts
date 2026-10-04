import { describe, expect, it } from "vitest";
import { devicePlatform, readSendShortcutMode, writeSendShortcutMode } from "./send-shortcut-preference";

function storageWith(value: string | null): Pick<Storage, "getItem" | "setItem"> {
  return { getItem: () => value, setItem: () => undefined };
}

describe("send shortcut preference", () => {
  it("falls back to Enter for absent or invalid stored values", () => {
    expect(readSendShortcutMode(storageWith(null))).toBe("enter");
    expect(readSendShortcutMode(storageWith("mod-enter"))).toBe("mod-enter");
    expect(readSendShortcutMode(storageWith("shift-enter"))).toBe("enter");
  });

  it("persists the mode and reads it back", () => {
    const store = new Map<string, string>();
    const storage: Pick<Storage, "getItem" | "setItem"> = {
      getItem: (key: string) => store.get(key) ?? null,
      setItem: (key: string, value: string) => {
        store.set(key, value);
      },
    };
    writeSendShortcutMode("mod-enter", storage);
    expect(store.get("openbot:send-shortcut-mode")).toBe("mod-enter");
    expect(readSendShortcutMode(storage)).toBe("mod-enter");
  });

  it("maps the browser platform to the device modifier", () => {
    expect(devicePlatform("macOS", "MacIntel")).toBe("darwin");
    expect(devicePlatform(undefined, "MacIntel")).toBe("darwin");
    expect(devicePlatform("Windows", "Win32")).toBe("win32");
    expect(devicePlatform(undefined, "Linux x86_64")).toBe("linux");
    expect(devicePlatform(undefined, undefined)).toBe("linux");
  });
});
