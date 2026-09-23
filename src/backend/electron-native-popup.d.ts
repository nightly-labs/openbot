import "electron";

// Electron 44 supplies these native popup APIs but omits them from its public declarations.
// https://github.com/electron/electron/blob/v44.0.0/lib/browser/guest-window-manager.ts#L64-L68
// https://github.com/electron/electron/blob/v44.0.0/shell/browser/api/electron_api_web_contents.cc#L1478-L1490
declare global {
  namespace Electron {
    interface BrowserWindowConstructorOptions {
      webContents?: WebContents;
    }

    interface WebContents {
      on(event: "close", listener: (event: Event) => void): this;
      once(event: "close", listener: (event: Event) => void): this;
    }
  }
}
