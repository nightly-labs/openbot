import { isDeepStrictEqual } from "node:util";
import type {
  BrowserDockAction,
  BrowserDockAnchor,
  BrowserDockFrame,
  BrowserDockGlass,
  BrowserDockPresentation,
} from "@openbot/contracts/ipc";
import { BROWSER_DOCK_LIMITS, BROWSER_DOCK_OVERLAY_WIDTH, IPC_ENDPOINTS } from "@openbot/contracts/ipc";
import { createOpenBotLogger } from "@openbot/logging";
import { Effect, Schema, Semaphore } from "effect";
import { type BrowserWindow, type Input, type Rectangle, View, type WebContents, WebContentsView } from "electron";
import type { BrowserMainPage } from "../backend/browser-host";
import { causeHelpers } from "../backend/effect-boundary";
import { onTilingLinuxDesktop } from "./linux-tiling-desktop";
import { sendToRenderer } from "./renderer-ipc";
import { isTrustedRendererUrl } from "./trusted-renderer";

const logger = createOpenBotLogger("browser-dock-overlay");

const INITIAL_HEIGHT = 160;
const SHRINK_DELAY_MS = 500;
const HEIGHT_STEP = 8;
const GLASS_BACKGROUND = "#01ffffff";

export interface BrowserDockOverlayOptions {
  mainWindow: BrowserWindow;
  preloadPath: string;
  load: (contents: WebContents) => Promise<void>;
  forwardShortcut: (input: Input) => boolean;
  keepPageBottomRoom: (height: number) => void;
}

export interface BrowserDockLayout {
  overlay: Rectangle;
  glass: Array<{ bounds: Rectangle; radius: number; blur: number }>;
}

export function browserDockLayout(
  page: BrowserMainPage,
  height: number,
  glass: readonly BrowserDockGlass[],
  anchor?: BrowserDockAnchor | null,
): BrowserDockLayout {
  const zoom = page.zoomFactor > 0 ? page.zoomFactor : 1;
  const wanted = Math.round((anchor?.width ?? BROWSER_DOCK_OVERLAY_WIDTH) * zoom);
  const width = Math.min(wanted, page.bounds.width);
  const overlayHeight = Math.min(Math.round(height * zoom), page.bounds.height);
  const overlay = {
    x: page.bounds.x + Math.round((page.bounds.width - width) / 2),
    y: page.bounds.y + page.bounds.height - overlayHeight,
    width,
    height: overlayHeight,
  };
  const bottom = overlay.y + overlay.height;
  const origin = overlay.x + (overlay.width - wanted) / 2;
  const shapes: BrowserDockLayout["glass"] = [];
  for (const shape of glass) {
    const left = Math.max(overlay.x, Math.round(origin + shape.left * zoom));
    const right = Math.min(overlay.x + overlay.width, Math.round(origin + (shape.left + shape.width) * zoom));
    const top = Math.max(overlay.y, Math.round(bottom - (shape.bottom + shape.height) * zoom));
    const end = Math.min(bottom, Math.round(bottom - shape.bottom * zoom));
    if (right <= left || end <= top) continue;
    const bounds = { x: left, y: top, width: right - left, height: end - top };
    shapes.push({
      bounds,
      radius: Math.min(shape.radius * zoom, bounds.width / 2, bounds.height / 2),
      blur: Math.min(shape.blur, BROWSER_DOCK_LIMITS.blur),
    });
  }
  return { overlay, glass: shapes };
}

export class BrowserDockOverlayFailed extends Schema.TaggedError<BrowserDockOverlayFailed>()(
  "BrowserDockOverlayFailed",
  { cause: Schema.Defect() },
) {}

const { io: overlayCall } = causeHelpers(BrowserDockOverlayFailed);

export class BrowserDockOverlay {
  readonly #options: BrowserDockOverlayOptions;
  readonly #creation = Semaphore.makeUnsafe(1);
  #view: WebContentsView | null = null;
  #loaded = false;
  readonly #glassViews: View[] = [];
  #presentation: BrowserDockPresentation | null = null;
  #page: BrowserMainPage | null = null;
  #height = INITIAL_HEIGHT;
  #glass: BrowserDockGlass[] = [];
  #anchor: BrowserDockAnchor | null = null;
  #seq = -1;
  #shrinkTimer: ReturnType<typeof setTimeout> | null = null;
  #shown = false;
  #dockHeight = 0;
  #pageBottomRoom = 0;
  #destroyed = false;

  constructor(options: BrowserDockOverlayOptions) {
    this.#options = options;
  }

  get mainRendererIds(): ReadonlySet<number> {
    const window = this.#options.mainWindow;
    return new Set(window.isDestroyed() ? [] : [window.webContents.id]);
  }

  get overlayRendererIds(): ReadonlySet<number> {
    const view = this.#view;
    return new Set(view && !view.webContents.isDestroyed() ? [view.webContents.id] : []);
  }

  get presentation(): BrowserDockPresentation | null {
    return this.#presentation;
  }

  readonly publish = Effect.fn("BrowserDockOverlay.publish")(function* (
    this: BrowserDockOverlay,
    presentation: BrowserDockPresentation | null,
  ): Effect.fn.Return<void, BrowserDockOverlayFailed> {
    if (this.#destroyed) return;
    if (isDeepStrictEqual(this.#presentation, presentation) && (presentation === null || this.#view)) return;
    this.#presentation = presentation;
    if (presentation) yield* this.#ensureView();
    const view = this.#view;
    if (view && this.#loaded) sendToRenderer(rendererOf(view), IPC_ENDPOINTS.browserDock.presentation, presentation);
    this.#sync();
  }).bind(this);

  setPage(page: BrowserMainPage | null): void {
    if (this.#destroyed) return;
    this.#page = page;
    this.#sync();
  }

  performAction(action: BrowserDockAction): void {
    sendToRenderer(this.#options.mainWindow, IPC_ENDPOINTS.browserDock.action, action);
  }

  setFrame(frame: BrowserDockFrame): void {
    if (this.#destroyed || frame.seq <= this.#seq) return;
    this.#seq = frame.seq;
    this.#glass = frame.glass;
    this.#anchor = frame.anchor ?? null;
    const height = Math.ceil(frame.height / HEIGHT_STEP) * HEIGHT_STEP;
    if (frame.height < BROWSER_DOCK_LIMITS.frameSize) this.#dockHeight = height;
    if (height >= this.#height) {
      this.#cancelShrink();
      this.#height = height;
    } else {
      this.#cancelShrink();
      this.#shrinkTimer = setTimeout(() => {
        this.#shrinkTimer = null;
        this.#height = height;
        this.#sync();
      }, SHRINK_DELAY_MS);
    }
    this.#sync();
  }

  destroy(): void {
    if (this.#destroyed) return;
    this.#destroyed = true;
    this.#cancelShrink();
    this.#presentation = null;
    this.#page = null;
    const window = this.#options.mainWindow;
    for (const glass of this.#glassViews) {
      if (!window.isDestroyed()) window.contentView.removeChildView(glass);
    }
    this.#glassViews.length = 0;
    const view = this.#view;
    if (view) this.#dropView(view);
  }

  readonly #ensureView = Effect.fn("BrowserDockOverlay.ensureView")(function* (this: BrowserDockOverlay) {
    yield* this.#creation.withPermit(
      Effect.gen({ self: this }, function* () {
        if (this.#view || this.#destroyed || this.#options.mainWindow.isDestroyed()) return;
        const view = this.#createView();
        this.#view = view;
        yield* overlayCall(() => this.#options.load(view.webContents)).pipe(
          Effect.tapError(() => Effect.sync(() => this.#dropView(view))),
        );
        if (this.#view === view && !view.webContents.isDestroyed()) this.#loaded = true;
      }),
    );
  });

  #createView(): WebContentsView {
    const view = new WebContentsView({
      webPreferences: {
        preload: this.#options.preloadPath,
        contextIsolation: true,
        sandbox: true,
        nodeIntegration: false,
        webSecurity: true,
      },
    });
    view.setBackgroundColor("#00000000");
    view.setVisible(false);
    const contents = view.webContents;
    if (onTilingLinuxDesktop) contents.setZoomMode("isolated");
    contents.setWindowOpenHandler(() => ({ action: "deny" }));
    contents.on("will-navigate", (event, targetUrl) => {
      if (!isTrustedRendererUrl(targetUrl)) event.preventDefault();
    });
    contents.on("before-input-event", (event, input) => {
      if (this.#options.forwardShortcut(input)) event.preventDefault();
    });
    contents.on("render-process-gone", (_event, details) => {
      logger.warn("The browser dock overlay stopped.", { reason: details.reason });
      if (this.#view === view) this.#dropView(view);
    });
    this.#options.mainWindow.contentView.addChildView(view);
    return view;
  }

  #dropView(view: WebContentsView): void {
    const window = this.#options.mainWindow;
    if (this.#view === view) {
      this.#view = null;
      this.#loaded = false;
      this.#seq = -1;
      this.#height = INITIAL_HEIGHT;
      this.#dockHeight = 0;
      this.#glass = [];
      this.#anchor = null;
    }
    if (!window.isDestroyed()) window.contentView.removeChildView(view);
    if (!view.webContents.isDestroyed()) view.webContents.close();
    this.#sync();
  }

  #cancelShrink(): void {
    if (this.#shrinkTimer) clearTimeout(this.#shrinkTimer);
    this.#shrinkTimer = null;
  }

  #sync(): void {
    const window = this.#options.mainWindow;
    const view = this.#view;
    const page = this.#page;
    const visible = Boolean(
      !this.#destroyed && this.#presentation && page && view && this.#loaded && !window.isDestroyed(),
    );
    if (!visible || !view || !page) {
      for (const glass of this.#glassViews) glass.setVisible(false);
      if (view && !view.webContents.isDestroyed()) {
        if (view.webContents.isFocused() && !window.isDestroyed()) window.webContents.focus();
        view.setVisible(false);
      }
      this.#setShown(false);
      this.#keepPageBottomRoom(0);
      return;
    }
    const layout = browserDockLayout(page, this.#height, this.#glass, this.#anchor);
    layout.glass.forEach((shape, index) => {
      const glass = this.#glassView(index);
      glass.setBounds(shape.bounds);
      glass.setBorderRadius(Math.round(shape.radius));
      glass.setBackgroundBlur(shape.blur);
      glass.setVisible(true);
      window.contentView.addChildView(glass);
    });
    for (const glass of this.#glassViews.slice(layout.glass.length)) glass.setVisible(false);
    view.setBounds(layout.overlay);
    view.setVisible(true);
    window.contentView.addChildView(view);
    if (view.webContents.getZoomFactor() !== page.zoomFactor) view.webContents.setZoomFactor(page.zoomFactor);
    this.#setShown(true);
    const dockHeight = Math.min(Math.round(this.#dockHeight * page.zoomFactor), layout.overlay.height);
    this.#keepPageBottomRoom(userActsOnPage(this.#presentation) ? dockHeight : 0);
  }

  #keepPageBottomRoom(height: number): void {
    if (this.#pageBottomRoom === height) return;
    this.#pageBottomRoom = height;
    this.#options.keepPageBottomRoom(height);
  }

  #glassView(index: number): View {
    const existing = this.#glassViews[index];
    if (existing) return existing;
    const glass = new View();
    glass.setBackgroundColor(GLASS_BACKGROUND);
    this.#glassViews.push(glass);
    return glass;
  }

  #setShown(shown: boolean): void {
    if (this.#shown === shown) return;
    this.#shown = shown;
    sendToRenderer(this.#options.mainWindow, IPC_ENDPOINTS.browserDock.shown, shown);
  }
}

function userActsOnPage(presentation: BrowserDockPresentation | null): boolean {
  const island = presentation?.island;
  return island?.kind === "activity" && island.control !== "agent";
}

function rendererOf(view: WebContentsView) {
  return { isDestroyed: () => view.webContents.isDestroyed(), webContents: view.webContents };
}

export function requireBrowserDockSender(actualId: number, expectedIds: ReadonlySet<number>, name: string): void {
  if (!expectedIds.has(actualId)) throw new Error(`Rejected browser dock IPC request outside the ${name}.`);
}
