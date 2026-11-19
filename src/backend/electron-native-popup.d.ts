import "electron";

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
