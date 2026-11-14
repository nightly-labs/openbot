import { SETTINGS_PANEL_DEFAULT, SETTINGS_PANEL_MAX } from "@openbot/ui/components/SettingsPanel";
import { createSignal } from "solid-js";
import { savePanelWidth } from "./panel-width-storage";

/**
 * All panes of the side panel have one width, so a change to another tab does not resize the panel.
 * Agent settings needs the most room, so its smallest width is the default and the smallest width of each pane.
 */
export const SIDE_PANEL_DEFAULT = SETTINGS_PANEL_DEFAULT;

const SIDE_PANEL_STORAGE_KEY = "openbot:side-panel-width";
/** Before the panes shared one width, Agent settings kept its own. A user who set it keeps that width. */
const SETTINGS_PANEL_STORAGE_KEY = "openbot:settings-panel-width";

/** The width from the last drag, or the default. */
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

/** The remembered width, read once from storage and written back when a drag ends. */
export function createSidePanelWidth() {
  return createSignal(readSidePanelWidth());
}
