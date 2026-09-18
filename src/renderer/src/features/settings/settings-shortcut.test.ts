import { describe, expect, it } from "vitest";
import { isOpenSettingsShortcut } from "./settings-shortcut";

describe("isOpenSettingsShortcut", () => {
  it("accepts Command+, and Control+,", () => {
    expect(isOpenSettingsShortcut({ key: ",", metaKey: true, ctrlKey: false, altKey: false, shiftKey: false })).toBe(
      true,
    );
    expect(isOpenSettingsShortcut({ key: ",", metaKey: false, ctrlKey: true, altKey: false, shiftKey: false })).toBe(
      true,
    );
  });

  it("does not claim a plain comma or a modified shortcut", () => {
    expect(isOpenSettingsShortcut({ key: ",", metaKey: false, ctrlKey: false, altKey: false, shiftKey: false })).toBe(
      false,
    );
    expect(isOpenSettingsShortcut({ key: ",", metaKey: true, ctrlKey: false, altKey: true, shiftKey: false })).toBe(
      false,
    );
    expect(isOpenSettingsShortcut({ key: ",", metaKey: true, ctrlKey: false, altKey: false, shiftKey: true })).toBe(
      false,
    );
    expect(isOpenSettingsShortcut({ key: ".", metaKey: true, ctrlKey: false, altKey: false, shiftKey: false })).toBe(
      false,
    );
  });
});
