// Electron side of `scripts/linux-agent-dock-e2e.ts`. It runs the real agent dock of the app: the window
// controller, the dock window of `main-window.ts`, the agent dock IPC handlers, the preload and the
// built dock renderer. This process plays the main renderer: it publishes a presentation, and its own
// full-screen window lies under the dock and counts the clicks that go through the dock.
//
// It reads one JSON command for each line of stdin and writes one answer line, `@@{...}`, to stdout.
// The end of stdin quits the app.
import { createReadStream, existsSync, statSync } from "node:fs";
import { createServer } from "node:http";
import { extname, resolve, sep } from "node:path";
import { createInterface } from "node:readline";
import type { AgentDockAgent, AgentDockInputRect, AgentDockPresentation } from "@openbot/contracts/ipc";
import { IPC_ENDPOINTS } from "@openbot/contracts/ipc";
import { Effect, Schema } from "effect";
import { app, BrowserWindow, ipcMain, screen } from "electron";
import { AgentDockWindowController } from "../src/main/agent-dock-window";
import { agentDockIpcHandlers } from "../src/main/ipc/agent-dock-handlers";
import { registerIpcGroup } from "../src/main/ipc/define-ipc-group";
import { aboveAppsWindowKind, usesX11Windows } from "../src/main/linux-wayland-output";
import { createAgentDockWindow, loadAgentDockRenderer } from "../src/main/main-window";

// A closed output must not stop the test app with an error dialog.
process.stdout.on("error", () => undefined);
process.stderr.on("error", () => undefined);

// The bundle is `out/linux-agent-dock-e2e/harness.cjs`: the dock window loads `out/preload/index.cjs`.
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

function agent(id: string, name: string): AgentDockAgent {
  return {
    id,
    name,
    title: "Agent",
    description: "",
    avatarSeed: id,
    avatarHue: null,
    avatarColor: null,
    avatarUrl: null,
  };
}

const AGENTS = [agent("agent-1", "Ada"), agent("agent-2", "Grace"), agent("agent-3", "Linus")];
const PRESENTATION: AgentDockPresentation = {
  serverId: "local",
  display: { kind: "primary" },
  edge: "right",
  autoHide: false,
  edgeStrip: false,
  sizePercent: 100,
  offsets: [],
  seats: AGENTS.map((item) => ({ kind: "agent", agent: item, mood: "idle", state: null })),
  available: [],
  availableChannels: [],
  agents: AGENTS,
  chats: AGENTS.map((item) => ({
    seat: { kind: "agent", id: item.id },
    messages: [
      {
        id: `${item.id}-m1`,
        author: "agent",
        senderAgentId: item.id,
        senderMember: null,
        kind: "text",
        body: `Hello from ${item.name}.`,
        attachments: [],
      },
    ],
    working: false,
    wait: null,
  })),
  results: [],
};

const sent: string[] = [];
const regions: { at: number; rects: AgentDockInputRect[] }[] = [];
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
let controller: AgentDockWindowController;

function dockWindow(): BrowserWindow | undefined {
  return BrowserWindow.getAllWindows().find((window) => window !== mainWindow && !window.isDestroyed());
}

/** The windows of the controller: the dock windows of all displays. */
function aboveAppsWindows(): number {
  return BrowserWindow.getAllWindows().filter((window) => window !== mainWindow && !window.isDestroyed()).length;
}

const CommandSchema = Schema.Union([
  Schema.Struct({ id: Schema.Number, op: Schema.Literal("dock") }),
  Schema.Struct({ id: Schema.Number, op: Schema.Literal("stats") }),
  Schema.Struct({
    id: Schema.Number,
    op: Schema.Literal("eval"),
    target: Schema.Literals(["dock", "main"]),
    js: Schema.String,
  }),
]);
type Command = typeof CommandSchema.Type;
const decodeCommand = Schema.decodeUnknownSync(Schema.fromJsonString(CommandSchema));

/** Answers one command of the driver. */
async function run(command: Command): Promise<void> {
  switch (command.op) {
    case "dock": {
      const window = dockWindow();
      answer(
        command.id,
        window && {
          bounds: window.getBounds(),
          xid: window.getNativeWindowHandle().readUInt32LE(0),
          visible: window.isVisible(),
          allWorkspaces: window.isVisibleOnAllWorkspaces(),
          mainPid: process.pid,
        },
      );
      return;
    }
    case "eval": {
      const window = command.target === "dock" ? dockWindow() : mainWindow;
      if (!window) throw new Error(`No ${command.target} window.`);
      answer(command.id, await window.webContents.executeJavaScript(command.js, true));
      return;
    }
    case "stats":
      answer(command.id, {
        sent,
        regions,
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
  // The "other app" under the dock: it counts the clicks that the dock lets through.
  mainWindow = new BrowserWindow({ ...primary.bounds, frame: false, show: false, backgroundColor: "#3b4252" });
  await mainWindow.loadURL(
    `data:text/html,${encodeURIComponent(
      "<body style='margin:0;height:100vh;overflow:hidden;background:linear-gradient(135deg,#2e3440,#5e81ac);font:20px sans-serif;color:#eceff4'>" +
        "<p style='margin:40px'>Window under the dock</p>" +
        "<script>window.clicks=[];addEventListener('mousedown',e=>clicks.push([e.screenX,e.screenY]))</script></body>",
    )}`,
  );
  mainWindow.showInactive();
  controller = new AgentDockWindowController({
    // `OPENBOT_E2E_SERVER=1` plays a self-hosted or hosted server: no window may open.
    windowKind: aboveAppsWindowKind(process.env.OPENBOT_E2E_SERVER === "1"),
    createWindow: (bounds) => {
      const window = createAgentDockWindow(bounds);
      window.webContents.on("console-message", (details) => {
        if (details.level === "error") rendererErrors.push(details.message);
        const missing = /No handler registered for '([^']+)'/u.exec(details.message);
        if (missing?.[1]) unhandled.add(missing[1]);
      });
      return window;
    },
    loadWindow: loadAgentDockRenderer,
    screen,
    getMainWindow: () => mainWindow,
    presentMainWindow: () => undefined,
    sendMessage: (action) =>
      Effect.sync(() => {
        sent.push(action.text);
      }),
  });
  const handlers = agentDockIpcHandlers({
    agentDock: {
      get mainRendererIds() {
        return controller.mainRendererIds;
      },
      get dockRendererIds() {
        return controller.dockRendererIds;
      },
      get presentation() {
        return controller.presentation;
      },
      publish: (presentation) => controller.publish(presentation),
      performAction: (rendererId, action) => controller.performAction(rendererId, action),
      setInteractive: (rendererId, input) => controller.setInteractive(rendererId, input),
      setInputRegion: (rendererId, rects) => {
        regions.push({ at: Date.now(), rects });
        controller.setInputRegion(rendererId, rects);
      },
      listDisplays: () => controller.listDisplays(),
      drag: (rendererId, phase) => controller.drag(rendererId, phase),
    },
    setXWayland: () => Effect.void,
  });
  registerIpcGroup("agentDock", handlers.agentDock);
  await Effect.runPromise(controller.publish(PRESENTATION));

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
