import type { ChatVisualKey } from "@openbot/contracts/chat-visual";
import { describe, expect, it } from "vitest";
import { isChatVisualAppShortcut } from "./chat-visual-shortcuts";

const key = (init: Partial<ChatVisualKey>): ChatVisualKey => ({
  key: "",
  code: "",
  metaKey: false,
  ctrlKey: false,
  shiftKey: false,
  altKey: false,
  ...init,
});

describe("isChatVisualAppShortcut", () => {
  it("gives the page's agent chords to the app, whatever key Option produces", () => {
    expect(isChatVisualAppShortcut(key({ key: "¡", code: "Digit1", metaKey: true, altKey: true }))).toBe(true);
    expect(isChatVisualAppShortcut(key({ key: "3", code: "Digit3", ctrlKey: true, altKey: true }))).toBe(true);
  });

  it("keeps the server chord, search and Settings", () => {
    expect(isChatVisualAppShortcut(key({ key: "2", code: "Digit2", metaKey: true }))).toBe(true);
    expect(isChatVisualAppShortcut(key({ key: "k", code: "KeyK", ctrlKey: true }))).toBe(true);
    expect(isChatVisualAppShortcut(key({ key: ",", code: "Comma", metaKey: true }))).toBe(true);
  });

  it("keeps other chords in the page", () => {
    expect(isChatVisualAppShortcut(key({ key: "0", code: "Digit0", metaKey: true, altKey: true }))).toBe(false);
    expect(
      isChatVisualAppShortcut(key({ key: "1", code: "Digit1", metaKey: true, altKey: true, shiftKey: true })),
    ).toBe(false);
    expect(isChatVisualAppShortcut(key({ key: "1", code: "Digit1", altKey: true }))).toBe(false);
  });
});
