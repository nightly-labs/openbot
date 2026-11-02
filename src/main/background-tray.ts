import type { AppTranslate } from "@openbot/i18n";
import { Menu, type NativeImage, Tray } from "electron";

export interface BackgroundTray {
  /** Shows the icon when OpenBot keeps running after its window closes, and removes it otherwise. */
  sync: (keepRunningInBackground: boolean) => void;
  /** Builds the menu again: a native label cannot be changed in place. */
  relabel: () => void;
  /** Shows the app icon in the logo color that the user chose. */
  setIcon: (icon: NativeImage) => void;
  destroy: () => void;
}

/**
 * The tray icon of Windows and Linux. When the main window is hidden in the background, it is the
 * way back to the window, and the way to quit.
 *
 * Linux desktops show the menu on a click and do not report the click, so the menu also opens the
 * window. A desktop with no tray, such as GNOME without an extension, shows nothing: a second
 * launch of OpenBot then shows the window.
 */
export function createBackgroundTray(options: {
  icon: NativeImage;
  translate: AppTranslate;
  open: () => void;
  quit: () => void;
}): BackgroundTray {
  let tray: Tray | null = null;
  let icon = options.icon;

  function relabel(): void {
    if (!tray) return;
    tray.setToolTip(options.translate("menu.trayTooltip"));
    tray.setContextMenu(
      Menu.buildFromTemplate([
        { label: options.translate("menu.trayOpen"), click: options.open },
        { type: "separator" },
        { label: options.translate("menu.trayQuit"), click: options.quit },
      ]),
    );
  }

  function destroy(): void {
    tray?.destroy();
    tray = null;
  }

  return {
    sync: (keepRunningInBackground) => {
      if (!keepRunningInBackground) {
        destroy();
        return;
      }
      if (tray) return;
      tray = new Tray(trayIcon(icon));
      tray.on("click", options.open);
      relabel();
    },
    relabel,
    setIcon: (next) => {
      icon = next;
      tray?.setImage(trayIcon(icon));
    },
    destroy,
  };
}

/** The app icon at the tray size, with a sharper copy for a scaled display. */
function trayIcon(source: NativeImage): NativeImage {
  const size = process.platform === "win32" ? 16 : 32;
  const icon = source.resize({ width: size, height: size, quality: "best" });
  icon.addRepresentation({
    scaleFactor: 2,
    buffer: source.resize({ width: size * 2, height: size * 2, quality: "best" }).toPNG(),
  });
  return icon;
}
