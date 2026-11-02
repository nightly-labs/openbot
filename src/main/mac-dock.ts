import { createOpenBotLogger, toLogValue } from "@openbot/logging";
import { app, BrowserWindow, type NativeImage } from "electron";
import { ensureMacApplicationPresence } from "./main-window-state";

const logger = createOpenBotLogger("mac-dock");

/** The last icon given to the Dock. Set again after `dock.show()`, so the tile keeps the chosen logo. */
let dockIcon: NativeImage | string | null = null;

export function setDockIcon(icon: NativeImage | string): void {
  dockIcon = icon;
  app.dock?.setIcon(icon);
}

/**
 * Shows the Dock icon that the menu bar mode hid. Call it before the window takes focus: the
 * activation policy changes with the Dock, and a change after the focus can move the focus away.
 * It does not fail.
 */
export async function showMacDock(): Promise<void> {
  const dock = app.dock;
  if (process.platform !== "darwin" || !dock || dock.isVisible()) return;
  try {
    await ensureMacApplicationPresence(
      process.platform,
      (policy) => app.setActivationPolicy(policy),
      () => dock.show(),
    );
    if (dockIcon) dock.setIcon(dockIcon);
  } catch (error) {
    // The window still shows. Without the Dock icon, the menu bar icon is the way back.
    logger.warn("Unable to show the Dock icon:", toLogValue(error));
  }
}

/**
 * Hides the Dock icon in menu bar mode, after the user closed the main window. A window that the
 * user can still see or bring back, such as a chat window or a minimized one, keeps the Dock icon.
 * A window that cannot take focus, such as the Dynamic Island, does not count.
 */
export function hideMacDockWhenNoWindowShows(): void {
  if (process.platform !== "darwin" || !app.dock) return;
  const windowShown = BrowserWindow.getAllWindows().some(
    (window) => !window.isDestroyed() && window.isFocusable() && (window.isVisible() || window.isMinimized()),
  );
  if (!windowShown) app.dock.hide();
}
