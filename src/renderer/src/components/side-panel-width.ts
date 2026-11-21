import { SETTINGS_PANEL_DEFAULT, SETTINGS_PANEL_MAX } from "@openbot/ui/components/SettingsPanel";
import { createSignal } from "solid-js";
import { savePanelWidth } from "./panel-width-storage";

export const SIDE_PANEL_DEFAULT = SETTINGS_PANEL_DEFAULT;

const SIDE_PANEL_STORAGE_KEY = "openbot:side-panel-width";
const SETTINGS_PANEL_STORAGE_KEY = "openbot:settings-panel-width";

export function readSidePanelWidth(): number {
  const stored = Number.parseFloat(
    window.localStorage.getItem(SIDE_PANEL_STORAGE_KEY) ??
      window.localStorage.getItem(SETTINGS_PANEL_STORAGE_KEY) ??
      "",
  );
  return Number.isFinite(stored)
    ? Math.min(SETTINGS_PANEL_MAX, Math.max(SIDE_PANEL_DEFAULT, stored))
    : SIDE_PANEL_DEFAULT;
}

export function saveSidePanelWidth(value: number) {
  savePanelWidth(SIDE_PANEL_STORAGE_KEY, value);
}

export function resetSidePanelWidth() {
  window.localStorage.removeItem(SIDE_PANEL_STORAGE_KEY);
  window.localStorage.removeItem(SETTINGS_PANEL_STORAGE_KEY);
}

export function createSidePanelWidth() {
  return createSignal(readSidePanelWidth());
}
