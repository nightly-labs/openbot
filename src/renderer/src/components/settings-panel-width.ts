import { SETTINGS_PANEL_DEFAULT, SETTINGS_PANEL_MAX, SETTINGS_PANEL_MIN } from "@openbot/ui/components/SettingsPanel";
import { createSignal } from "solid-js";
import { readPanelWidth, savePanelWidth } from "./panel-width-storage";
/** The remembered width, read once from storage and written back when a drag ends. */
export function createSettingsPanelWidth() {
  return createSignal(
    readPanelWidth(SETTINGS_PANEL_STORAGE_KEY, SETTINGS_PANEL_DEFAULT, SETTINGS_PANEL_MIN, SETTINGS_PANEL_MAX),
  );
}

export function saveSettingsPanelWidth(value: number) {
  savePanelWidth(SETTINGS_PANEL_STORAGE_KEY, value);
}

const SETTINGS_PANEL_STORAGE_KEY = "openbot:settings-panel-width";
