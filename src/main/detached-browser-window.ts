import type {
  BrowserBounds,
  BrowserWindowAction,
  BrowserWindowEvent,
  BrowserWindowModel,
} from "@openbot/contracts/ipc";
import { Effect, Schema } from "effect";
import { BrowserWindow, screen } from "electron";
import type { BrowserHost } from "../backend/browser-host";
import { causeHelpers } from "../backend/effect-boundary";
import {
  DETACHED_BROWSER_MIN_HEIGHT,
  DETACHED_BROWSER_MIN_WIDTH,
  detachedBrowserWindowBounds,
} from "./detached-browser-window-bounds";
import { isTrustedRendererUrl } from "./trusted-renderer";
import { followAppearance, windowBackgroundColor } from "./window-appearance";

interface DetachedBrowserWindowOptions {
  mainWindow: BrowserWindow;
  browser: Pick<BrowserHost, "setPictureInPictureWindow">;
  preloadPath: string;
  iconPath: string;
  developmentUrl?: string | undefined;
  onEvent: (event: BrowserWindowEvent) => void;
  onModel: (window: BrowserWindow, model: BrowserWindowModel) => void;
}

const DETACHED_BROWSER_DARK_BACKGROUND = "#111415";

export class DetachedBrowserWindow {
  readonly #options: DetachedBrowserWindowOptions;
  #window: BrowserWindow | null = null;
  #model: BrowserWindowModel | null = null;
  #closing = false;

  readonly #mainPageGone = () => {
    this.close();
    this.#model = null;
  };

  readonly #mainPageNavigating = (details: { isMainFrame: boolean; isSameDocument: boolean }) => {
    if (details.isMainFrame && !details.isSameDocument) this.#mainPageGone();
  };

  constructor(options: DetachedBrowserWindowOptions) {
    this.#options = options;
    const mainContents = options.mainWindow.webContents;
    mainContents.on("did-start-navigation", this.#mainPageNavigating);
    mainContents.on("render-process-gone", this.#mainPageGone);
  }

  isOpen(): boolean {
    return this.#window !== null && !this.#window.isDestroyed();
  }

  readonly open = Effect.fn("DetachedBrowserWindow.open")(function* (
    this: DetachedBrowserWindow,
    savedBounds?: BrowserBounds,
  ): Effect.fn.Return<BrowserBounds, DetachedBrowserWindowFailed> {
    const existing = this.#window;
    if (existing && !existing.isDestroyed()) {
      existing.show();
      existing.focus();
      return existing.getBounds();
    }

    const bounds = detachedBrowserWindowBounds(
      savedBounds,
      this.#options.mainWindow.getBounds(),
      screen.getAllDisplays().map((display) => display.workArea),
    );
    const window = new BrowserWindow({
      ...bounds,
      minWidth: DETACHED_BROWSER_MIN_WIDTH,
      minHeight: DETACHED_BROWSER_MIN_HEIGHT,
      show: false,
      backgroundColor: windowBackgroundColor(DETACHED_BROWSER_DARK_BACKGROUND),
      title: "OpenBot Browser",
      icon: this.#options.iconPath,
      webPreferences: {
        preload: this.#options.preloadPath,
        contextIsolation: true,
        devTools: true,
        sandbox: true,
        nodeIntegration: false,
        webSecurity: true,
      },
    });
    followAppearance(window, DETACHED_BROWSER_DARK_BACKGROUND);
    this.#window = window;
    this.#closing = false;
    this.#options.browser.setPictureInPictureWindow(window, { shortcuts: true });
    window.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
    window.webContents.on("will-navigate", (event, targetUrl) => {
      if (!isTrustedRendererUrl(targetUrl)) event.preventDefault();
    });
    const sendBounds = () => {
      if (window.isDestroyed()) return;
      this.#options.onEvent({ type: "bounds-changed", bounds: window.getNormalBounds() });
    };
    window.on("moved", sendBounds);
    window.on("resized", sendBounds);
    window.on("closed", () => {
      if (this.#window !== window) return;
      this.#window = null;
      this.#options.browser.setPictureInPictureWindow(null);
      if (!this.#closing) this.#options.onEvent({ type: "hide" });
      this.#closing = false;
    });

    const developmentUrl = this.#options.developmentUrl;
    const pageUrl = developmentUrl
      ? new URL("browser-window.html", `${developmentUrl}/`)
      : new URL("openbot-app://app/browser-window.html");
    yield* windowCall(() => window.loadURL(pageUrl.toString()));
    if (window.isDestroyed()) return bounds;
    window.show();
    return window.getNormalBounds();
  }).bind(this);

  focus(): void {
    const window = this.#window;
    if (!window || window.isDestroyed()) return;
    if (window.isMinimized()) window.restore();
    window.show();
    window.focus();
  }

  close(): void {
    const window = this.#window;
    if (!window || window.isDestroyed()) return;
    this.#closing = true;
    this.#window = null;
    this.#options.browser.setPictureInPictureWindow(null);
    window.destroy();
  }

  dock(senderId: number): void {
    if (!this.#sentByWindow(senderId)) return;
    this.close();
    this.#options.onEvent({ type: "dock" });
  }

  publishModel(senderId: number, model: BrowserWindowModel): void {
    const mainContents = this.#options.mainWindow.webContents;
    if (mainContents.isDestroyed() || senderId !== mainContents.id) return;
    this.#model = model;
    const window = this.#window;
    if (window && !window.isDestroyed()) this.#options.onModel(window, model);
  }

  model(senderId: number): BrowserWindowModel | null {
    return this.#sentByWindow(senderId) ? this.#model : null;
  }

  sendAction(senderId: number, action: BrowserWindowAction): void {
    if (this.#sentByWindow(senderId)) this.#options.onEvent({ type: "action", action });
  }

  destroy(): void {
    const mainContents = this.#options.mainWindow.webContents;
    if (!mainContents.isDestroyed()) {
      mainContents.off("did-start-navigation", this.#mainPageNavigating);
      mainContents.off("render-process-gone", this.#mainPageGone);
    }
    this.#mainPageGone();
  }

  #sentByWindow(senderId: number): boolean {
    const window = this.#window;
    return window !== null && !window.isDestroyed() && window.webContents.id === senderId;
  }
}

export class DetachedBrowserWindowFailed extends Schema.TaggedError<DetachedBrowserWindowFailed>()(
  "DetachedBrowserWindowFailed",
  { cause: Schema.Defect() },
) {}

const { io: windowCall } = causeHelpers(DetachedBrowserWindowFailed);
