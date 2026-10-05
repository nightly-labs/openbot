import { describe, expect, it } from "vitest";
import { isSendShortcutKey, parseSendShortcutMode, resolveSendShortcut } from "./send-shortcut";

function key(overrides: Partial<KeyboardEvent> = {}): {
  key: string;
  metaKey: boolean;
  ctrlKey: boolean;
  shiftKey: boolean;
  altKey: boolean;
} {
  return { key: "Enter", metaKey: false, ctrlKey: false, shiftKey: false, altKey: false, ...overrides };
}

describe("parseSendShortcutMode", () => {
  it("keeps Enter when the stored value is absent or invalid", () => {
    expect(parseSendShortcutMode(undefined)).toBe("enter");
    expect(parseSendShortcutMode("shift-enter")).toBe("enter");
    expect(parseSendShortcutMode("mod-enter")).toBe("mod-enter");
  });
});

describe("resolveSendShortcut", () => {
  it("keeps Enter in the default mode on every platform", () => {
    expect(resolveSendShortcut("enter", "darwin")).toBe("enter");
    expect(resolveSendShortcut("enter", "win32")).toBe("enter");
    expect(resolveSendShortcut("enter", "linux")).toBe("enter");
  });

  it("resolves the modifier from the device platform", () => {
    expect(resolveSendShortcut("mod-enter", "darwin")).toBe("meta-enter");
    expect(resolveSendShortcut("mod-enter", "win32")).toBe("ctrl-enter");
    expect(resolveSendShortcut("mod-enter", "linux")).toBe("ctrl-enter");
  });
});

describe("isSendShortcutKey", () => {
  it("sends on plain Enter only in the Enter mode", () => {
    expect(isSendShortcutKey(key(), "enter")).toBe(true);
    expect(isSendShortcutKey(key({ shiftKey: true }), "enter")).toBe(false);
    expect(isSendShortcutKey(key({ metaKey: true }), "enter")).toBe(false);
    expect(isSendShortcutKey(key({ ctrlKey: true }), "enter")).toBe(false);
    expect(isSendShortcutKey(key(), "meta-enter")).toBe(false);
    expect(isSendShortcutKey(key(), "ctrl-enter")).toBe(false);
  });

  it("sends only on the exact platform chord in the modifier mode", () => {
    expect(isSendShortcutKey(key({ metaKey: true }), "meta-enter")).toBe(true);
    expect(isSendShortcutKey(key({ metaKey: true, shiftKey: true }), "meta-enter")).toBe(false);
    expect(isSendShortcutKey(key({ metaKey: true, altKey: true }), "meta-enter")).toBe(false);
    expect(isSendShortcutKey(key({ ctrlKey: true }), "meta-enter")).toBe(false);
    expect(isSendShortcutKey(key({ ctrlKey: true }), "ctrl-enter")).toBe(true);
    expect(isSendShortcutKey(key({ ctrlKey: true, shiftKey: true }), "ctrl-enter")).toBe(false);
    expect(isSendShortcutKey(key({ metaKey: true }), "ctrl-enter")).toBe(false);
  });

  it("ignores other keys", () => {
    expect(isSendShortcutKey(key({ key: "a", metaKey: true }), "meta-enter")).toBe(false);
  });
});
