import type { AppTranslate } from "@openbot/i18n";
import { Menu, type MenuItemConstructorOptions, type NativeImage, Tray } from "electron";

export interface BackgroundTray {
  /** Shows the icon when OpenBot keeps running after its window closes, and removes it otherwise. */
  sync: (keepRunningInBackground: boolean) => void;
  /** Builds the menu again: a native label cannot be changed in place. */
  relabel: () => void;
  /** Shows the app icon in the logo color that the user chose. */
  setIcon: (icon: NativeImage) => void;
  /**
   * The names of the members who control this computer now, one per remote desktop session. While
   * there is one, the icon shows also when OpenBot does not run in the background, and its menu names
   * them and can stop all remote control.
   */
  setRemoteControl: (memberNames: readonly string[]) => void;
  destroy: () => void;
}

/**
 * The tray icon of Windows and Linux, and the menu bar icon of macOS. When the main window is hidden
 * in the background, it is the way back to the window, and the way to quit. On macOS the Dock icon
 * stays, and is a way back too.
 *
 * Linux desktops show the menu on a click and do not report the click, so the menu also opens the
 * window. A desktop with no tray, such as GNOME without an extension, shows nothing: a second
 * launch of OpenBot then shows the window.
 */
export function createBackgroundTray(options: {
  icon: NativeImage;
  /** A macOS template image. When given, it is the icon, and the logo color does not change it. */
  menuBarIcon: NativeImage | null;
  translate: AppTranslate;
  open: () => void;
  quit: () => void;
  /** Ends every remote desktop session on this computer. */
  stopRemoteControl: () => void;
}): BackgroundTray {
  let tray: Tray | null = null;
  let icon = options.icon;
  let keepRunningInBackground = false;
  let remoteControl: readonly string[] = [];

  function relabel(): void {
    if (!tray) return;
    const controlled = remoteControl.length > 0;
    tray.setToolTip(options.translate(controlled ? "remoteDesktop.host.trayTooltip" : "menu.trayTooltip"));
    const remoteItems: MenuItemConstructorOptions[] = controlled
      ? [
          ...remoteControl.map(
            (name): MenuItemConstructorOptions => ({
              label: options.translate("remoteDesktop.host.trayControlledBy", { name }),
              enabled: false,
            }),
          ),
          { label: options.translate("remoteDesktop.host.stopAll"), click: options.stopRemoteControl },
          { type: "separator" },
        ]
      : [];
    tray.setContextMenu(
      Menu.buildFromTemplate([
        ...remoteItems,
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

  /** The icon shows while OpenBot runs in the background or a member controls this computer. */
  function update(): void {
    if (!keepRunningInBackground && remoteControl.length === 0) {
      destroy();
      return;
    }
    if (!tray) {
      tray = new Tray(options.menuBarIcon ?? trayIcon(icon));
      tray.on("click", options.open);
    }
    relabel();
  }

  return {
    sync: (next) => {
      keepRunningInBackground = next;
      update();
    },
    relabel,
    setIcon: (next) => {
      icon = next;
      if (!options.menuBarIcon) tray?.setImage(trayIcon(icon));
    },
    setRemoteControl: (memberNames) => {
      remoteControl = [...memberNames];
      update();
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
