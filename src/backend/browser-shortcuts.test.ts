import { describe, expect, it } from "vitest";
import {
  browserContextMenuItems,
  chatContextMenuItems,
  isCloseBrowserTabShortcut,
  isCollapseBrowserShortcut,
  isGlobalSearchShortcut,
  isSelectAllShortcut,
  isToggleDevToolsShortcut,
} from "./browser-shortcuts";

const input = (overrides: Partial<Parameters<typeof isCloseBrowserTabShortcut>[0]> = {}) => ({
  type: "keyDown",
  key: "w",
  control: false,
  meta: false,
  alt: false,
  shift: false,
  ...overrides,
});

describe("isGlobalSearchShortcut", () => {
  it("accepts Control+K and Command+K", () => {
    expect(isGlobalSearchShortcut(input({ control: true, key: "k" }))).toBe(true);
    expect(isGlobalSearchShortcut(input({ meta: true, key: "K" }))).toBe(true);
  });

  it("does not claim modified shortcuts or key-up events", () => {
    expect(isGlobalSearchShortcut(input({ key: "k" }))).toBe(false);
    expect(isGlobalSearchShortcut(input({ control: true, key: "k", shift: true }))).toBe(false);
    expect(isGlobalSearchShortcut(input({ meta: true, key: "k", alt: true }))).toBe(false);
    expect(isGlobalSearchShortcut(input({ control: true, key: "k", type: "keyUp" }))).toBe(false);
  });
});

describe("isCloseBrowserTabShortcut", () => {
  it("accepts Control+W and Command+W", () => {
    expect(isCloseBrowserTabShortcut(input({ control: true }))).toBe(true);
    expect(isCloseBrowserTabShortcut(input({ meta: true, key: "W" }))).toBe(true);
  });

  it("does not claim modified shortcuts or key-up events", () => {
    expect(isCloseBrowserTabShortcut(input())).toBe(false);
    expect(isCloseBrowserTabShortcut(input({ control: true, shift: true }))).toBe(false);
    expect(isCloseBrowserTabShortcut(input({ meta: true, alt: true }))).toBe(false);
    expect(isCloseBrowserTabShortcut(input({ control: true, type: "keyUp" }))).toBe(false);
  });
});

describe("isCollapseBrowserShortcut", () => {
  it("accepts a bare Escape key-down", () => {
    expect(isCollapseBrowserShortcut(input({ key: "Escape" }))).toBe(true);
  });

  it("does not claim modified shortcuts or key-up events", () => {
    expect(isCollapseBrowserShortcut(input({ key: "Escape", type: "keyUp" }))).toBe(false);
    expect(isCollapseBrowserShortcut(input({ key: "Escape", meta: true }))).toBe(false);
    expect(isCollapseBrowserShortcut(input({ key: "Escape", control: true }))).toBe(false);
    expect(isCollapseBrowserShortcut(input({ key: "Escape", alt: true }))).toBe(false);
    expect(isCollapseBrowserShortcut(input({ key: "Escape", shift: true }))).toBe(false);
  });
});

describe("isSelectAllShortcut", () => {
  it("accepts Control+A and Command+A", () => {
    expect(isSelectAllShortcut(input({ control: true, key: "a" }))).toBe(true);
    expect(isSelectAllShortcut(input({ meta: true, key: "A" }))).toBe(true);
  });

  it("does not claim modified shortcuts or key-up events", () => {
    expect(isSelectAllShortcut(input({ key: "a" }))).toBe(false);
    expect(isSelectAllShortcut(input({ control: true, key: "a", shift: true }))).toBe(false);
    expect(isSelectAllShortcut(input({ meta: true, key: "a", alt: true }))).toBe(false);
    expect(isSelectAllShortcut(input({ control: true, key: "a", type: "keyUp" }))).toBe(false);
  });
});

describe("isToggleDevToolsShortcut", () => {
  it("accepts F12 and the common platform shortcuts", () => {
    expect(isToggleDevToolsShortcut(input({ key: "F12" }))).toBe(true);
    expect(isToggleDevToolsShortcut(input({ control: true, shift: true, key: "i" }))).toBe(true);
    expect(isToggleDevToolsShortcut(input({ meta: true, alt: true, key: "I" }))).toBe(true);
  });

  it("does not claim incomplete shortcuts or key-up events", () => {
    expect(isToggleDevToolsShortcut(input({ key: "i", control: true }))).toBe(false);
    expect(isToggleDevToolsShortcut(input({ key: "i", meta: true, alt: true, shift: true }))).toBe(false);
    expect(isToggleDevToolsShortcut(input({ key: "F12", type: "keyUp" }))).toBe(false);
  });
});

describe("chatContextMenuItems", () => {
  it("offers copy and select-all for selected chat text", () => {
    expect(chatContextMenuItems({ selectionText: "hello", isEditable: false, linkURL: "" })).toEqual([
      "copy",
      "select-all",
    ]);
  });

  it("offers only select-all in an empty editable field", () => {
    expect(chatContextMenuItems({ selectionText: "  ", isEditable: true, linkURL: "" })).toEqual(["select-all"]);
  });

  it("puts copy-link first when right-clicking a link", () => {
    expect(chatContextMenuItems({ selectionText: "docs", isEditable: false, linkURL: "https://example.com" })).toEqual([
      "copy-link",
      "separator",
      "copy",
      "select-all",
    ]);
  });

  it("keeps no menu where there is nothing to copy", () => {
    expect(chatContextMenuItems({ selectionText: "", isEditable: false, linkURL: "" })).toEqual([]);
  });
});

describe("browserContextMenuItems", () => {
  const page = (overrides: Partial<Parameters<typeof browserContextMenuItems>[0]> = {}) => ({
    selectionText: "",
    isEditable: false,
    linkURL: "",
    srcURL: "",
    mediaType: "none",
    ...overrides,
  });

  it("offers copy and select-all for text selected on a page", () => {
    expect(browserContextMenuItems(page({ selectionText: "Uber Eats" }))).toEqual(["copy", "select-all"]);
  });

  it("puts copy-link first when right-clicking a link", () => {
    expect(browserContextMenuItems(page({ linkURL: "https://example.com/very/long/path?share=1" }))).toEqual([
      "copy-link",
    ]);
  });

  it("offers the full edit set in a page form field", () => {
    expect(browserContextMenuItems(page({ selectionText: "draft", isEditable: true }))).toEqual([
      "cut",
      "copy",
      "paste",
      "select-all",
    ]);
  });

  it("offers paste in an empty form field", () => {
    expect(browserContextMenuItems(page({ isEditable: true }))).toEqual(["paste", "select-all"]);
  });

  it("offers the image address only for an image", () => {
    expect(browserContextMenuItems(page({ srcURL: "https://example.com/a.png", mediaType: "image" }))).toEqual([
      "copy-image-address",
    ]);
    expect(browserContextMenuItems(page({ srcURL: "https://example.com/a.mp4", mediaType: "video" }))).toEqual([]);
  });

  it("keeps no menu where there is nothing to copy", () => {
    expect(browserContextMenuItems(page())).toEqual([]);
  });
});
