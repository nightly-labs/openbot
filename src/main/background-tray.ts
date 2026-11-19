import type { AppTranslate } from "@openbot/i18n";
import { Menu, type MenuItemConstructorOptions, type NativeImage, Tray } from "electron";

export interface BackgroundTray {
  sync: (keepRunningInBackground: boolean) => void;
  relabel: () => void;
  setIcon: (icon: NativeImage) => void;
  setRemoteControl: (memberNames: readonly string[]) => void;
  setHiddenWhileWorking: (hidden: boolean) => void;
  destroy: () => void;
}

export function createBackgroundTray(options: {
  icon: NativeImage;
  menuBarIcon: NativeImage | null;
  translate: AppTranslate;
  open: () => void;
  quit: () => void;
  stopRemoteControl: () => void;
}): BackgroundTray {
  let tray: Tray | null = null;
  let icon = options.icon;
  let keepRunningInBackground = false;
  let remoteControl: readonly string[] = [];
  let hiddenWhileWorking = false;

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

  function update(): void {
    if (!keepRunningInBackground && !hiddenWhileWorking && remoteControl.length === 0) {
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
    setHiddenWhileWorking: (hidden) => {
      if (hidden === hiddenWhileWorking) return;
      hiddenWhileWorking = hidden;
      update();
    },
    destroy,
  };
}

function trayIcon(source: NativeImage): NativeImage {
  const size = process.platform === "win32" ? 16 : 32;
  const icon = source.resize({ width: size, height: size, quality: "best" });
  icon.addRepresentation({
    scaleFactor: 2,
    buffer: source.resize({ width: size * 2, height: size * 2, quality: "best" }).toPNG(),
  });
  return icon;
}
