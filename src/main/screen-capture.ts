import { sourceText } from "@openbot/i18n/source";
import { createOpenBotLogger, toLogValue } from "@openbot/logging";
import { Effect } from "effect";
import {
  ScreenCaptureFailed,
  type ScreenCaptureHost,
  type ScreenCaptureImage,
  type ScreenCaptureRectangle,
  type ScreenCaptureRequest,
  type ScreenCaptureSources,
} from "../backend/agent/screen-capture";

/**
 * Captures the desktop for `capture_screen` with Electron's `desktopCapturer`.
 *
 * A display is captured at its own pixels: a thumbnail of the display's size in points times its
 * scale factor. A region is cut from the capture of the one display that holds it, so a region on a
 * secondary display or on a display with another scale factor comes out at that display's pixels.
 *
 * On macOS the Screen Recording grant is read before each capture. Without it macOS gives only the
 * wallpaper, and a capture of the wallpaper must not reach the model as if it were the screen.
 */

const logger = createOpenBotLogger("screen-capture");

/** The same bound as a browser screenshot: a larger image costs the model more than it shows it. */
const MAX_CAPTURE_PIXELS = 4_194_304;
const MAX_LISTED_WINDOWS = 100;
/**
 * The thumbnail box for a window capture. `desktopCapturer` draws every open window at this size to
 * return one, so the box stays small. A window keeps its aspect ratio inside the box.
 */
const WINDOW_THUMBNAIL_SIZE = { width: 1920, height: 1920 };

/** The part of a `NativeImage` that a capture uses, so a test can pass a double. */
export interface CaptureImage {
  isEmpty(): boolean;
  getSize(): { width: number; height: number };
  crop(rectangle: ScreenCaptureRectangle): CaptureImage;
  resize(options: { width: number; height: number; quality: "good" }): CaptureImage;
  toPNG(): Uint8Array;
}

/** The part of a `DesktopCapturerSource` that a capture uses. */
interface CaptureSource {
  id: string;
  name: string;
  /** The `Display.id` of a screen source, as a string. Empty for a window, and on some Linux desktops. */
  display_id: string;
  thumbnail: CaptureImage;
}

/** The part of an Electron `Display` that a capture uses. */
interface CaptureDisplay {
  id: number;
  label: string;
  bounds: ScreenCaptureRectangle;
  scaleFactor: number;
}

export interface ScreenCapturerOptions {
  platform: NodeJS.Platform;
  /** `systemPreferences.getMediaAccessStatus("screen")`. Read on macOS only. */
  screenAccess: () => string;
  displays: () => CaptureDisplay[];
  primaryDisplayId: () => number;
  getSources: (options: {
    types: Array<"screen" | "window">;
    thumbnailSize: { width: number; height: number };
  }) => Promise<CaptureSource[]>;
}

function failure(reason: string) {
  return new ScreenCaptureFailed({ reason });
}

/** The cause stays in the log. The agent gets only the safe reason. */
function captureFailed(operation: string) {
  return (cause: unknown) => {
    logger.warn("A screen capture failed.", { operation, cause: toLogValue(cause) });
    return failure(sourceText("error.agent.screenCaptureFailed"));
  };
}

function nativeSize(display: CaptureDisplay) {
  return {
    width: Math.max(1, Math.round(display.bounds.width * display.scaleFactor)),
    height: Math.max(1, Math.round(display.bounds.height * display.scaleFactor)),
  };
}

function contains(outer: ScreenCaptureRectangle, inner: ScreenCaptureRectangle): boolean {
  return (
    inner.x >= outer.x &&
    inner.y >= outer.y &&
    inner.x + inner.width <= outer.x + outer.width &&
    inner.y + inner.height <= outer.y + outer.height
  );
}

/** The region in the pixels of the display capture. The scale is read from the image, not assumed. */
function regionPixels(
  display: CaptureDisplay,
  image: { width: number; height: number },
  region: ScreenCaptureRectangle,
): ScreenCaptureRectangle {
  const scaleX = image.width / display.bounds.width;
  const scaleY = image.height / display.bounds.height;
  const x = Math.min(image.width - 1, Math.max(0, Math.round((region.x - display.bounds.x) * scaleX)));
  const y = Math.min(image.height - 1, Math.max(0, Math.round((region.y - display.bounds.y) * scaleY)));
  return {
    x,
    y,
    width: Math.max(1, Math.min(image.width - x, Math.round(region.width * scaleX))),
    height: Math.max(1, Math.min(image.height - y, Math.round(region.height * scaleY))),
  };
}

function bounded(image: CaptureImage): CaptureImage {
  const size = image.getSize();
  const area = size.width * size.height;
  if (area <= MAX_CAPTURE_PIXELS) return image;
  const scale = Math.sqrt(MAX_CAPTURE_PIXELS / area);
  return image.resize({
    width: Math.max(1, Math.floor(size.width * scale)),
    height: Math.max(1, Math.floor(size.height * scale)),
    quality: "good",
  });
}

export class ScreenCapturer implements ScreenCaptureHost {
  readonly #options: ScreenCapturerOptions;
  #askedForPermission = false;

  constructor(options: ScreenCapturerOptions) {
    this.#options = options;
  }

  readonly listSources = Effect.fn("ScreenCapturer.listSources")(function* (
    this: ScreenCapturer,
  ): Effect.fn.Return<ScreenCaptureSources, ScreenCaptureFailed> {
    yield* this.#requirePermission(false);
    const displays = yield* this.listDisplays();
    const windows = yield* this.#sources(["window"], { width: 0, height: 0 });
    return {
      displays,
      windows: windows.slice(0, MAX_LISTED_WINDOWS).map((window) => ({ id: window.id, name: window.name })),
    };
  });

  listDisplays(): Effect.Effect<ScreenCaptureSources["displays"]> {
    return Effect.sync(() => {
      const primary = this.#options.primaryDisplayId();
      return this.#options.displays().map((display) => ({
        id: String(display.id),
        name: display.label,
        bounds: { ...display.bounds },
        scaleFactor: display.scaleFactor,
        primary: display.id === primary,
      }));
    });
  }

  /** True on macOS without the grant, until the first capture of this process asked for it. */
  promptsForPermission(): Effect.Effect<boolean> {
    return Effect.sync(() => {
      if (this.#options.platform !== "darwin" || this.#askedForPermission) return false;
      try {
        return this.#options.screenAccess() !== "granted";
      } catch {
        return false;
      }
    });
  }

  readonly capture = Effect.fn("ScreenCapturer.capture")(function* (
    this: ScreenCapturer,
    request: ScreenCaptureRequest,
  ): Effect.fn.Return<ScreenCaptureImage, ScreenCaptureFailed> {
    yield* this.#requirePermission(true);
    const displays = this.#options.displays();
    if (request.target === "window") {
      const source = (yield* this.#sources(["window"], WINDOW_THUMBNAIL_SIZE)).find(
        ({ id }) => id === request.windowId,
      );
      if (!source) return yield* failure(sourceText("error.agent.screenCaptureWindowMissing"));
      return yield* this.#encode(this.#nonEmpty(source.thumbnail), source.name);
    }
    const display =
      request.target === "region"
        ? displays.find(({ bounds }) => contains(bounds, request.region))
        : displays.find(({ id }) =>
            request.displayId ? String(id) === request.displayId : id === this.#options.primaryDisplayId(),
          );
    if (!display) {
      return yield* failure(
        sourceText(
          request.target === "region"
            ? "error.agent.screenCaptureRegionOutside"
            : "error.agent.screenCaptureDisplayMissing",
        ),
      );
    }
    const sources = yield* this.#sources(["screen"], nativeSize(display));
    // Some Linux desktops give no display id. With one display there is only one screen to take.
    const source =
      sources.find(({ display_id }) => display_id === String(display.id)) ??
      (displays.length === 1 && sources.length === 1 ? sources[0] : undefined);
    if (!source) return yield* failure(sourceText("error.agent.screenCaptureDisplayMissing"));
    const image = yield* this.#nonEmpty(source.thumbnail);
    const name = display.label || source.name;
    if (request.target !== "region") return yield* this.#encode(Effect.succeed(image), name);
    const pixels = regionPixels(display, image.getSize(), request.region);
    return yield* this.#encode(
      Effect.try({
        try: () => image.crop(pixels),
        catch: captureFailed("crop"),
      }),
      name,
    );
  });

  /**
   * macOS asks the user for Screen Recording the first time an app captures, and gives only the
   * wallpaper until the user grants it. Chromium reads the grant as granted or denied only, so a
   * grant that was never asked for also reads as denied. The first refusal in this process makes one
   * capture whose result is thrown away, which shows the macOS prompt when the user was never asked.
   * Only a capture that the user approved does this: a list of the sources never asks (#9092).
   */
  readonly #requirePermission = Effect.fn("ScreenCapturer.requirePermission")(function* (
    this: ScreenCapturer,
    ask: boolean,
  ) {
    if (this.#options.platform !== "darwin") return;
    const status = yield* Effect.try({
      try: () => this.#options.screenAccess(),
      catch: () => failure(sourceText("error.agent.screenCapturePermissionMissing")),
    });
    if (status === "granted") return;
    if (!ask && !this.#askedForPermission) {
      return yield* failure(sourceText("error.agent.screenCaptureListPermission"));
    }
    if (!this.#askedForPermission) {
      this.#askedForPermission = true;
      yield* this.#sources(["screen"], { width: 1, height: 1 }).pipe(Effect.ignore);
    }
    return yield* failure(sourceText("error.agent.screenCapturePermissionMissing"));
  });

  #sources(types: Array<"screen" | "window">, thumbnailSize: { width: number; height: number }) {
    return Effect.tryPromise({
      try: () => this.#options.getSources({ types, thumbnailSize }),
      catch: captureFailed("sources"),
    });
  }

  /** An empty image is a capture that the system refused, not a black screen. */
  #nonEmpty(image: CaptureImage): Effect.Effect<CaptureImage, ScreenCaptureFailed> {
    if (!image.isEmpty()) return Effect.succeed(image);
    return Effect.fail(
      failure(
        sourceText(
          this.#options.platform === "win32"
            ? "error.agent.screenCaptureEmptyWindows"
            : this.#options.platform === "darwin"
              ? "error.agent.screenCapturePermissionMissing"
              : "error.agent.screenCaptureFailed",
        ),
      ),
    );
  }

  #encode(image: Effect.Effect<CaptureImage, ScreenCaptureFailed>, sourceName: string) {
    return image.pipe(
      Effect.flatMap((captured) =>
        Effect.try({
          try: (): ScreenCaptureImage => {
            const result = bounded(captured);
            const size = result.getSize();
            return { png: result.toPNG(), width: size.width, height: size.height, sourceName };
          },
          catch: captureFailed("encode"),
        }),
      ),
    );
  }
}
