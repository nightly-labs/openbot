import { createRoot } from "solid-js";
import { afterEach, expect, it } from "vitest";
import { createSettingsPanelWidth, saveSettingsPanelWidth } from "./settings-panel-width";

const key = "openbot:settings-panel-width";
afterEach(() => localStorage.removeItem(key));

it("restores the existing panel preference and saves a resized width under the same key", () => {
  localStorage.setItem(key, "420");
  createRoot((dispose) => {
    const [width] = createSettingsPanelWidth();
    expect(width()).toBe(420);
    saveSettingsPanelWidth(512.4);
    expect(localStorage.getItem(key)).toBe("512");
    dispose();
  });
});

it("uses the existing default after the panel preference is cleared", () => {
  localStorage.removeItem(key);
  createRoot((dispose) => {
    const [width] = createSettingsPanelWidth();
    expect(width()).toBe(296);
    dispose();
  });
});
