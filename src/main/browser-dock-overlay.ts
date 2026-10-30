// The dock over a local page of the browser full view. The page is a native view above the renderer, so
// the dock in the renderer is under it. A transparent view above the page draws the same dock, and one
// native blur view under it for each glass shape blurs the page. The main renderer owns the conversation:
// it publishes what the dock shows and does the actions that the overlay sends back.

import { isDeepStrictEqual } from "node:util";
import type {
  BrowserDockAction,
  BrowserDockFrame,
  BrowserDockGlass,
  BrowserDockPresentation,
} from "@openbot/contracts/ipc";
import { BROWSER_DOCK_LIMITS, IPC_ENDPOINTS } from "@openbot/contracts/ipc";
import { createOpenBotLogger } from "@openbot/logging";
import { Effect, Schema, Semaphore } from "effect";
import { type BrowserWindow, type Input, type Rectangle, View, type WebContents, WebContentsView } from "electron";
import type { BrowserMainPage } from "../backend/browser-host";
import { causeHelpers } from "../backend/effect-boundary";
import { sendToRenderer } from "./renderer-ipc";
import { isTrustedRendererUrl } from "./trusted-renderer";

const logger = createOpenBotLogger("browser-dock-overlay");

/** The dock is at most 640 CSS pixels wide, with 24 on each side, so the overlay is never wider. */
export const BROWSER_DOCK_OVERLAY_WIDTH = 688;
/** The height of the overlay, in CSS pixels, until it reports the space that the dock needs. */
const INITIAL_HEIGHT = 160;
/** A smaller frame waits for this time, so a dock that shrinks while it moves is not cut. */
const SHRINK_DELAY_MS = 500;
/** The height changes in steps of this size, so a small change does not move the overlay. */
const HEIGHT_STEP = 8;
/**
 * A blur view needs a background with an alpha channel to show its blur. This one is almost clear: the
 * overlay draws the tint and the border of the glass.
 */
const GLASS_BACKGROUND = "#01ffffff";

export interface BrowserDockOverlayOptions {
  mainWindow: BrowserWindow;
  preloadPath: string;
  load: (contents: WebContents) => Promise<void>;
  /** The keys of the window that work while the overlay has the focus. True when the window takes the key. */
  forwardShortcut: (input: Input) => boolean;
}

/** The overlay and its glass shapes, in window pixels. */
export interface BrowserDockLayout {
  overlay: Rectangle;
  glass: Array<{ bounds: Rectangle; radius: number; blur: number }>;
}

/**
 * Where the overlay and its glass go over `page`. The overlay is at the bottom centre of the page, and no
 * part of it or of a glass shape is outside the page.
 */
export function browserDockLayout(
  page: BrowserMainPage,
  height: number,
  glass: readonly BrowserDockGlass[],
): BrowserDockLayout {
  const zoom = page.zoomFactor > 0 ? page.zoomFactor : 1;
  const width = Math.min(Math.round(BROWSER_DOCK_OVERLAY_WIDTH * zoom), page.bounds.width);
  const overlayHeight = Math.min(Math.round(height * zoom), page.bounds.height);
  const overlay = {
    x: page.bounds.x + Math.round((page.bounds.width - width) / 2),
    y: page.bounds.y + page.bounds.height - overlayHeight,
    width,
    height: overlayHeight,
  };
  const bottom = overlay.y + overlay.height;
  const shapes: BrowserDockLayout["glass"] = [];
  for (const shape of glass) {
    const left = Math.max(overlay.x, Math.round(overlay.x + shape.left * zoom));
    const right = Math.min(overlay.x + overlay.width, Math.round(overlay.x + (shape.left + shape.width) * zoom));
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

/** The overlay view did not load. The cause is what the renderer reads. */
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
  /** The height that the overlay has, in CSS pixels, and the glass of its last frame. */
  #height = INITIAL_HEIGHT;
  #glass: BrowserDockGlass[] = [];
  #seq = -1;
  #shrinkTimer: ReturnType<typeof setTimeout> | null = null;
  #shown = false;
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

  /** Null hides the overlay. The first dock creates the overlay view and waits until it loads. */
  readonly publish = Effect.fn("BrowserDockOverlay.publish")(function* (
    this: BrowserDockOverlay,
    presentation: BrowserDockPresentation | null,
  ): Effect.fn.Return<void, BrowserDockOverlayFailed> {
    if (this.#destroyed) return;
    // The same presentation again still brings back a view that failed or was dropped.
    if (isDeepStrictEqual(this.#presentation, presentation) && (presentation === null || this.#view)) return;
    this.#presentation = presentation;
    if (presentation) yield* this.#ensureView();
    const view = this.#view;
    if (view && this.#loaded) sendToRenderer(rendererOf(view), IPC_ENDPOINTS.browserDock.presentation, presentation);
    this.#sync();
  }).bind(this);

  /** The page of the main window moved or hid. The page view is raised, so the overlay goes above it again. */
  setPage(page: BrowserMainPage | null): void {
    if (this.#destroyed) return;
    this.#page = page;
    this.#sync();
  }

  performAction(action: BrowserDockAction): void {
    sendToRenderer(this.#options.mainWindow, IPC_ENDPOINTS.browserDock.action, action);
  }

  /** The space that the dock needs. A taller dock gets it at once; a shorter one after a pause. */
  setFrame(frame: BrowserDockFrame): void {
    if (this.#destroyed || frame.seq <= this.#seq) return;
    this.#seq = frame.seq;
    this.#glass = frame.glass;
    const height = Math.ceil(frame.height / HEIGHT_STEP) * HEIGHT_STEP;
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
    contents.setWindowOpenHandler(() => ({ action: "deny" }));
    contents.on("will-navigate", (event, targetUrl) => {
      if (!isTrustedRendererUrl(targetUrl)) event.preventDefault();
    });
    contents.on("before-input-event", (event, input) => {
      if (this.#options.forwardShortcut(input)) event.preventDefault();
    });
    contents.on("render-process-gone", (_event, details) => {
      logger.warn("The browser dock overlay stopped.", { reason: details.reason });
      // The next dock makes a new overlay. Until then the dock in the renderer is the one that works.
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
      this.#glass = [];
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
        // A hidden view that keeps the focus would take the keys of the window.
        if (view.webContents.isFocused() && !window.isDestroyed()) window.webContents.focus();
        view.setVisible(false);
      }
      this.#setShown(false);
      return;
    }
    const layout = browserDockLayout(page, this.#height, this.#glass);
    // The page view was raised, so the glass and then the overlay go above it again, in this order.
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
    // The overlay draws in the CSS pixels of the main window.
    if (view.webContents.getZoomFactor() !== page.zoomFactor) view.webContents.setZoomFactor(page.zoomFactor);
    this.#setShown(true);
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

function rendererOf(view: WebContentsView) {
  return { isDestroyed: () => view.webContents.isDestroyed(), webContents: view.webContents };
}

export function requireBrowserDockSender(actualId: number, expectedIds: ReadonlySet<number>, name: string): void {
  if (!expectedIds.has(actualId)) throw new Error(`Rejected browser dock IPC request outside the ${name}.`);
}
