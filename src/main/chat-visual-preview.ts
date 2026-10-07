import { randomUUID } from "node:crypto";
import {
  CHAT_VISUAL_MAX_HEIGHT,
  CHAT_VISUAL_MIN_HEIGHT,
  chatVisualAppTheme,
  chatVisualFrameUrl,
} from "@openbot/contracts/chat-visual";
import { redactText } from "@openbot/logging";
import { Effect, Semaphore } from "effect";
import { BrowserWindow, session as electronSession, type NativeImage, type Session } from "electron";
import {
  ChatVisualPreviewFailed,
  type ChatVisualPreviewHost,
  type ChatVisualPreviewRequest,
  type ChatVisualPreviewResult,
} from "../backend/agent/chat-visual-preview";
import { chatVisualResponse } from "./chat-visual-protocol";

/**
 * Draws a visual reply page for `html_preview` in a window that is never shown.
 *
 * The window has its own session in memory, so the page cannot read the app's cookies, storage or
 * attachments. The page gets the same sandbox and frame script as in the chat, and it can load files
 * from the network, as it can there. It cannot ask for a permission, download a file, open a window
 * or leave its address.
 */

const PREVIEW_PARTITION = "openbot-visual-preview";
const PREVIEW_HOST = "preview";
const PREVIEW_TIMEOUT = "20 seconds";
const INITIAL_HEIGHT = 600;
const CONSOLE_LINE_LIMIT = 40;
const CONSOLE_LINE_LENGTH = 500;
/** The same bound as a browser screenshot: a larger image costs the model more than it shows it. */
const MAX_CAPTURE_PIXELS = 4_194_304;
/** A script in its own world, so the page cannot replace the functions that it calls. */
const SCRIPT_WORLD = 1_017;
/** The measure of the frame script in the chat: `scrollHeight` is never less than the window. */
const SETTLED_HEIGHT_SCRIPT = `new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(() =>
  setTimeout(() => resolve(Math.ceil(document.documentElement.getBoundingClientRect().height)), 250))))`;
const NEXT_FRAME_SCRIPT =
  "new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve(true))))";

const CONSOLE_LEVELS: Record<string, string> = { warning: "warn", error: "error" };

function previewFailure(reason: string) {
  return new ChatVisualPreviewFailed({ reason });
}

function settledHeight(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) && value > 0 ? Math.ceil(value) : CHAT_VISUAL_MIN_HEIGHT;
}

function boundedPng(image: NativeImage): string {
  const size = image.getSize();
  if (size.width <= 0 || size.height <= 0) throw new Error("The page drew nothing.");
  const area = size.width * size.height;
  if (area <= MAX_CAPTURE_PIXELS) return image.toDataURL();
  const scale = Math.sqrt(MAX_CAPTURE_PIXELS / area);
  return image
    .resize({
      width: Math.max(1, Math.floor(size.width * scale)),
      height: Math.max(1, Math.floor(size.height * scale)),
      quality: "good",
    })
    .toDataURL();
}

export class ChatVisualPreviewer implements ChatVisualPreviewHost {
  readonly #pages = new Map<string, Uint8Array>();
  /** One page at a time: each one is a renderer process. */
  readonly #lock = Semaphore.makeUnsafe(1);
  #session: Session | null = null;

  #previewSession(): Session {
    if (this.#session) return this.#session;
    const session = electronSession.fromPartition(PREVIEW_PARTITION);
    session.protocol.handle("openbot-visual", (request) => {
      const url = new URL(request.url);
      const page = url.hostname === PREVIEW_HOST ? this.#pages.get(url.pathname.slice(1)) : undefined;
      return page ? chatVisualResponse(page) : new Response("Not found", { status: 404 });
    });
    session.setPermissionRequestHandler((_contents, _permission, callback) => callback(false));
    session.setPermissionCheckHandler(() => false);
    session.on("will-download", (event) => event.preventDefault());
    this.#session = session;
    return session;
  }

  readonly capture = Effect.fn("ChatVisualPreviewer.capture")(function* (
    this: ChatVisualPreviewer,
    request: ChatVisualPreviewRequest,
  ): Effect.fn.Return<ChatVisualPreviewResult, ChatVisualPreviewFailed> {
    return yield* this.#lock.withPermit(
      Effect.acquireUseRelease(
        Effect.try({
          try: () => {
            this.#previewSession();
            // Not `offscreen`: after a resize, its capture loses every canvas that does not draw again,
            // so a chart comes out empty.
            const window = new BrowserWindow({
              show: false,
              width: request.width,
              height: INITIAL_HEIGHT,
              useContentSize: true,
              enableLargerThanScreen: true,
              webPreferences: {
                sandbox: true,
                contextIsolation: true,
                nodeIntegration: false,
                backgroundThrottling: false,
                partition: PREVIEW_PARTITION,
              },
            });
            const token = randomUUID();
            this.#pages.set(token, new TextEncoder().encode(request.html));
            return { token, window };
          },
          catch: () => previewFailure("OpenBot could not open a window to draw the page."),
        }),
        ({ token, window }) => this.#draw(window, token, request),
        ({ token, window }) =>
          Effect.sync(() => {
            this.#pages.delete(token);
            if (!window.isDestroyed()) window.destroy();
          }),
      ),
    );
  });

  readonly #draw = Effect.fn("ChatVisualPreviewer.draw")(function* (
    this: ChatVisualPreviewer,
    window: BrowserWindow,
    token: string,
    request: ChatVisualPreviewRequest,
  ): Effect.fn.Return<ChatVisualPreviewResult, ChatVisualPreviewFailed> {
    const contents = window.webContents;
    const console: string[] = [];
    contents.on("console-message", (event) => {
      // A development build warns about its own policy on every page; the agent did not write it.
      if (console.length >= CONSOLE_LINE_LIMIT || event.message.startsWith("%cElectron Security Warning")) return;
      const level = CONSOLE_LEVELS[event.level] ?? "log";
      // The lines go to the provider, so a key that the page logs is removed first.
      console.push(`[${level}] ${redactText(event.message).slice(0, CONSOLE_LINE_LENGTH)}`);
    });
    contents.setWindowOpenHandler(() => ({ action: "deny" }));
    contents.on("will-navigate", (event) => event.preventDefault());
    contents.on("will-redirect", (event) => event.preventDefault());
    const theme = chatVisualAppTheme(request.appearance);
    const url = chatVisualFrameUrl(`openbot-visual://${PREVIEW_HOST}/${token}`, theme);
    return yield* Effect.gen(function* () {
      yield* Effect.tryPromise({
        try: () => contents.loadURL(url),
        catch: () => previewFailure("The page did not load."),
      });
      // The agent sees the page on the chat canvas, so the capture has the canvas colour. A page has
      // a transparent canvas, and a window, unlike a frame, has no chat behind it. The user origin
      // lets a page that sets its own background keep it.
      yield* Effect.tryPromise({
        try: () => contents.insertCSS(`html{background:${theme["--background"]}}`, { cssOrigin: "user" }),
        catch: () => previewFailure("The page did not load."),
      });
      const contentHeight = settledHeight(
        yield* Effect.tryPromise({
          try: () => contents.executeJavaScriptInIsolatedWorld(SCRIPT_WORLD, [{ code: SETTLED_HEIGHT_SCRIPT }]),
          catch: () => previewFailure("The page did not finish drawing."),
        }),
      );
      const height = Math.min(Math.max(contentHeight, CHAT_VISUAL_MIN_HEIGHT), CHAT_VISUAL_MAX_HEIGHT);
      window.setContentSize(request.width, height);
      yield* Effect.tryPromise({
        try: () => contents.executeJavaScriptInIsolatedWorld(SCRIPT_WORLD, [{ code: NEXT_FRAME_SCRIPT }]),
        catch: () => previewFailure("The page did not finish drawing."),
      });
      const image = yield* Effect.tryPromise({
        try: () => contents.capturePage(),
        catch: () => previewFailure("OpenBot could not capture the page."),
      });
      const imageUrl = yield* Effect.try({
        try: () => boundedPng(image),
        catch: () => previewFailure("The page drew nothing."),
      });
      return { imageUrl, contentHeight, console: [...console] };
    }).pipe(
      Effect.timeoutOrElse({
        duration: PREVIEW_TIMEOUT,
        orElse: () => Effect.fail(previewFailure("The page did not finish drawing in 20 seconds.")),
      }),
    );
  });
}
