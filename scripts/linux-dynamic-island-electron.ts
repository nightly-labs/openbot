// Electron side of `scripts/linux-dynamic-island-e2e.ts`. It runs the real Dynamic Island of the app: the
// window controller, the island window of `main-window.ts`, the Dynamic Island IPC handlers, the preload
// and the built island renderer. This process plays the main renderer: it publishes the presentations,
// and its own full-screen window lies under the island and counts the clicks that go through it.
//
// It reads one JSON command for each line of stdin and writes one answer line, `@@{...}`, to stdout.
// The end of stdin quits the app.
import { createReadStream, existsSync, statSync } from "node:fs";
import { createServer } from "node:http";
import { extname, join, resolve, sep } from "node:path";
import { createInterface } from "node:readline";
import {
  type AgentDockInputRect,
  DEFAULT_DYNAMIC_ISLAND_PREFERENCE,
  type DynamicIslandAction,
  IPC_ENDPOINTS,
  isDynamicIslandPresentation,
} from "@openbot/contracts/ipc";
import { Effect, Schema } from "effect";
import { app, BrowserWindow, ipcMain, screen } from "electron";
import { DynamicIslandWindowController } from "../src/main/dynamic-island-window";
import { registerIpcGroup } from "../src/main/ipc/define-ipc-group";
import { dynamicIslandIpcHandlers } from "../src/main/ipc/dynamic-island-handlers";
import { aboveAppsWindowKind, usesX11Windows } from "../src/main/linux-wayland-output";
import { createDynamicIslandWindow, loadDynamicIslandRenderer } from "../src/main/main-window";

// A closed output must not stop the test app with an error dialog.
process.stdout.on("error", () => undefined);
process.stderr.on("error", () => undefined);

// The bundle is `out/linux-dynamic-island-e2e/harness.cjs`: the island window loads `out/preload/index.cjs`.
const RENDERER_ROOT = resolve(__dirname, "..", "renderer");
const CONTENT_TYPES: Record<string, string> = {
  ".html": "text/html",
  ".js": "text/javascript",
  ".mjs": "text/javascript",
  ".css": "text/css",
  ".json": "application/json",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".woff2": "font/woff2",
  ".wasm": "application/wasm",
};

const actions: DynamicIslandAction[] = [];
const regions: { at: number; rects: AgentDockInputRect[] }[] = [];
const interactive: { at: number; interactive: boolean; keyboard: boolean }[] = [];
const rendererErrors: string[] = [];
const unhandled = new Set<string>();

/** Serves the built renderer as the development server does, so the trusted-origin check applies. */
function serveRenderer(): Promise<string> {
  const server = createServer((request, response) => {
    const path = decodeURIComponent(new URL(request.url ?? "/", "http://localhost").pathname);
    const file = resolve(RENDERER_ROOT, `.${path}`);
    if (!file.startsWith(RENDERER_ROOT + sep) || !existsSync(file) || !statSync(file).isFile()) {
      response.writeHead(404).end();
      return;
    }
    response.writeHead(200, { "content-type": CONTENT_TYPES[extname(file)] ?? "application/octet-stream" });
    createReadStream(file).pipe(response);
  });
  return new Promise((done) =>
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      done(`http://127.0.0.1:${typeof address === "object" && address ? address.port : 0}`);
    }),
  );
}

/**
 * The helper renderer also reads the language: the answer that a fresh profile gets. Other calls fail,
 * and the report lists them.
 */
function registerOtherHandlers(): void {
  ipcMain.handle(IPC_ENDPOINTS.app.getAppLanguagePreference.channel, () => ({ language: "en" }));
}

let mainWindow: BrowserWindow | null = null;
let controller: DynamicIslandWindowController;

function islandWindow(): BrowserWindow | undefined {
  return BrowserWindow.getAllWindows().find((window) => window !== mainWindow && !window.isDestroyed());
}

/** The windows of the controller: the island windows of all displays. */
function aboveAppsWindows(): number {
  return BrowserWindow.getAllWindows().filter((window) => window !== mainWindow && !window.isDestroyed()).length;
}

const CommandSchema = Schema.Union([
  Schema.Struct({ id: Schema.Number, op: Schema.Literal("island") }),
  Schema.Struct({ id: Schema.Number, op: Schema.Literal("stats") }),
  Schema.Struct({ id: Schema.Number, op: Schema.Literal("publish"), presentation: Schema.Unknown }),
  Schema.Struct({
    id: Schema.Number,
    op: Schema.Literal("eval"),
    target: Schema.Literals(["island", "main"]),
    js: Schema.String,
  }),
]);
type Command = typeof CommandSchema.Type;
const decodeCommand = Schema.decodeUnknownSync(Schema.fromJsonString(CommandSchema));

/** Answers one command of the driver. */
async function run(command: Command): Promise<void> {
  switch (command.op) {
    case "island": {
      const window = islandWindow();
      answer(
        command.id,
        window && {
          bounds: window.getBounds(),
          workArea: screen.getPrimaryDisplay().workArea,
          xid: window.getNativeWindowHandle().readUInt32LE(0),
          visible: window.isVisible(),
          allWorkspaces: window.isVisibleOnAllWorkspaces(),
          mainPid: process.pid,
        },
      );
      return;
    }
    case "publish":
      if (!isDynamicIslandPresentation(command.presentation)) throw new Error("The presentation is invalid.");
      controller.publish(command.presentation);
      answer(command.id, null);
      return;
    case "eval": {
      const window = command.target === "island" ? islandWindow() : mainWindow;
      if (!window) throw new Error(`No ${command.target} window.`);
      answer(command.id, await window.webContents.executeJavaScript(command.js, true));
      return;
    }
    case "stats":
      answer(command.id, {
        actions,
        regions,
        interactive,
        rendererErrors,
        unhandled: [...unhandled],
        x11: usesX11Windows(),
        aboveAppsWindows: aboveAppsWindows(),
      });
      return;
  }
}

function answer(id: number, value: unknown): void {
  process.stdout.write(`@@${JSON.stringify({ id, ok: true, value: value ?? null })}\n`);
}

// No top-level await: Electron does not get ready until the main module has run to its end.
void app
  .whenReady()
  .then(start)
  .catch((cause: unknown) => {
    process.stdout.write(`@@failed ${cause instanceof Error ? (cause.stack ?? cause.message) : String(cause)}\n`);
    app.exit(1);
  });

async function start(): Promise<void> {
  process.env.ELECTRON_RENDERER_URL = await serveRenderer();
  registerOtherHandlers();
  const primary = screen.getPrimaryDisplay();
  // The "other app" under the island: it counts the clicks that the island lets through.
  mainWindow = new BrowserWindow({ ...primary.bounds, frame: false, show: false, backgroundColor: "#3b4252" });
  await mainWindow.loadURL(
    `data:text/html,${encodeURIComponent(
      "<body style='margin:0;height:100vh;overflow:hidden;background:linear-gradient(135deg,#2e3440,#5e81ac);font:20px sans-serif;color:#eceff4'>" +
        "<p style='margin:120px 40px'>Window under the Dynamic Island</p>" +
        "<script>window.clicks=[];addEventListener('mousedown',e=>clicks.push([e.screenX,e.screenY]))</script></body>",
    )}`,
  );
  mainWindow.showInactive();
  controller = new DynamicIslandWindowController({
    // `OPENBOT_E2E_SERVER=1` plays a self-hosted or hosted server: no window may open.
    windowKind: aboveAppsWindowKind(process.env.OPENBOT_E2E_SERVER === "1"),
    preferencePath: join(app.getPath("userData"), "dynamic-island-preference.json"),
    defaultPreference: DEFAULT_DYNAMIC_ISLAND_PREFERENCE,
    createWindow: (bounds, display) => {
      const window = createDynamicIslandWindow(bounds, display);
      window.webContents.on("console-message", (details) => {
        if (details.level === "error") rendererErrors.push(details.message);
        const missing = /No handler registered for '([^']+)'/u.exec(details.message);
        if (missing?.[1]) unhandled.add(missing[1]);
      });
      return window;
    },
    loadWindow: (window, display) => loadDynamicIslandRenderer(window, display, "production"),
    getDisplays: () => screen.getAllDisplays(),
    getPrimaryDisplay: () => screen.getPrimaryDisplay(),
    getMainWindow: () => mainWindow,
    presentMainWindow: () => undefined,
    performHaptic: () => undefined,
    // A reply or an answer reaches no agent in this test. The handler records each action.
    performCriticalAction: () => Effect.void,
  });
  const handlers = dynamicIslandIpcHandlers({
    dynamicIsland: {
      get mainRendererIds() {
        return controller.mainRendererIds;
      },
      get overlayRendererIds() {
        return controller.overlayRendererIds;
      },
      get preference() {
        return controller.preference;
      },
      get presentation() {
        return controller.presentation;
      },
      get builtInDisplayGeometry() {
        return controller.builtInDisplayGeometry;
      },
      setPreference: (preference) => controller.setPreference(preference),
      publish: (presentation) => controller.publish(presentation),
      performAction: (action) => {
        actions.push(action);
        return controller.performAction(action);
      },
      performHaptic: () => controller.performHaptic(),
      setInteractive: (rendererId, state, keyboard) => {
        interactive.push({ at: Date.now(), interactive: state, keyboard: keyboard ?? false });
        controller.setInteractive(rendererId, state, keyboard);
      },
      setInputRegion: (rendererId, rects) => {
        regions.push({ at: Date.now(), rects });
        controller.setInputRegion(rendererId, rects);
      },
    },
    setXWayland: () => Effect.void,
    keepXWayland: () => Effect.void,
  });
  registerIpcGroup("dynamicIsland", handlers.dynamicIsland);
  await Effect.runPromise(controller.initialize());
  await Effect.runPromise(controller.reconcileWindow());

  const lines = createInterface({ input: process.stdin });
  lines.on("line", (line) => {
    if (!line.trim()) return;
    const command = decodeCommand(line);
    run(command).catch((error: unknown) => {
      const message = error instanceof Error ? error.message : String(error);
      process.stdout.write(`@@${JSON.stringify({ id: command.id, ok: false, error: message })}\n`);
    });
  });
  lines.on("close", () => app.quit());
  process.stdout.write("@@ready\n");
}
