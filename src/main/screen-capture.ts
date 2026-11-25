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

const logger = createOpenBotLogger("screen-capture");

const MAX_CAPTURE_PIXELS = 4_194_304;
const MAX_LISTED_WINDOWS = 100;
const WINDOW_THUMBNAIL_SIZE = { width: 1920, height: 1920 };

export interface CaptureImage {
  isEmpty(): boolean;
  getSize(): { width: number; height: number };
  crop(rectangle: ScreenCaptureRectangle): CaptureImage;
  resize(options: { width: number; height: number; quality: "good" }): CaptureImage;
  toPNG(): Uint8Array;
}

interface CaptureSource {
  id: string;
  name: string;
  display_id: string;
  thumbnail: CaptureImage;
}

interface CaptureDisplay {
  id: number;
  label: string;
  bounds: ScreenCaptureRectangle;
  scaleFactor: number;
}

export interface ScreenCapturerOptions {
  platform: NodeJS.Platform;
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
    const source =
      sources.find(({ display_id }) => display_id === String(display.id)) ??
      (displays.length === 1 && sources.length === 1 ? sources[0] : undefined);
    if (!source) return yield* this.#noScreenSource(display, sources);
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

  #noScreenSource(display: CaptureDisplay, sources: CaptureSource[]): Effect.Effect<never, ScreenCaptureFailed> {
    logger.warn("No screen source matched a connected display.", {
      displayId: String(display.id),
      sourceDisplayIds: sources.map(({ display_id }) => display_id),
    });
    return Effect.fail(
      failure(
        sourceText(
          this.#options.platform === "darwin"
            ? "error.agent.screenCapturePermissionMissing"
            : "error.agent.screenCaptureFailed",
        ),
      ),
    );
  }

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
