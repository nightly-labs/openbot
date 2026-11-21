import { expect, it } from "vitest";
import { chatSearchCommand } from "./chat-search-shortcut";

const press = (key: string, mods: { meta?: boolean; ctrl?: boolean; alt?: boolean; shift?: boolean } = {}) => ({
  key,
  metaKey: mods.meta === true,
  ctrlKey: mods.ctrl === true,
  altKey: mods.alt === true,
  shiftKey: mods.shift === true,
});

it("opens on Ctrl+F on Windows and Linux, but not on macOS", () => {
  expect(chatSearchCommand(press("f", { ctrl: true }), "pc", false)).toBe("open");
  expect(chatSearchCommand(press("f", { ctrl: true }), "mac", false)).toBeUndefined();
});

it("opens on Cmd+F on macOS, but not on Windows and Linux", () => {
  expect(chatSearchCommand(press("f", { meta: true }), "mac", false)).toBe("open");
  expect(chatSearchCommand(press("f", { meta: true }), "pc", false)).toBeUndefined();
});

it("rejects F with the other modifier held, with Alt, or with Shift", () => {
  expect(chatSearchCommand(press("f", { meta: true, ctrl: true }), "mac", false)).toBeUndefined();
  expect(chatSearchCommand(press("f", { meta: true, ctrl: true }), "pc", false)).toBeUndefined();
  expect(chatSearchCommand(press("f", { meta: true, alt: true }), "mac", false)).toBeUndefined();
  expect(chatSearchCommand(press("f", { meta: true, shift: true }), "mac", false)).toBeUndefined();
  expect(chatSearchCommand(press("f", { ctrl: true, shift: true }), "pc", false)).toBeUndefined();
});

it("moves to the next or previous match only while the search is open", () => {
  expect(chatSearchCommand(press("g", { meta: true }), "mac", true)).toBe("next");
  expect(chatSearchCommand(press("g", { meta: true, shift: true }), "mac", true)).toBe("prev");
  expect(chatSearchCommand(press("g", { ctrl: true }), "pc", true)).toBe("next");
  expect(chatSearchCommand(press("g", { ctrl: true, shift: true }), "pc", true)).toBe("prev");
  expect(chatSearchCommand(press("g", { meta: true }), "mac", false)).toBeUndefined();
});

it("ignores Ctrl+G on macOS and Cmd+G elsewhere", () => {
  expect(chatSearchCommand(press("g", { ctrl: true }), "mac", true)).toBeUndefined();
  expect(chatSearchCommand(press("g", { meta: true }), "pc", true)).toBeUndefined();
});

it("ignores a bare F or G", () => {
  expect(chatSearchCommand(press("f"), "mac", false)).toBeUndefined();
  expect(chatSearchCommand(press("g"), "pc", true)).toBeUndefined();
});
