import { execFileSync, spawn } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { createServer } from "node:http";
import { createServer as createNetServer } from "node:net";
import { extname, join, relative, resolve } from "node:path";
import { WebSocket as Socket, WebSocketServer } from "ws";
import { withoutElectronRuntimeFlags } from "../electron-spawn-env";
import {
  DEBUGGING_PORT_FILE,
  DEVTOOLS_ENDPOINT_FILE,
  DEVTOOLS_PATH,
  isLiveProvider,
  PROJECT_ROOT,
  profilePath,
  RENDERER_HOST,
} from "./targets";

const [provider, portText] = process.argv.slice(2);
const rendererPort = Number(portText);
if (!isLiveProvider(provider) || !Number.isInteger(rendererPort) || rendererPort <= 0) {
  throw new Error("Usage: start-app.ts <codex|claude|antigravity|grok> <renderer port>");
}

const rendererRoot = join(PROJECT_ROOT, "out", "renderer");
const profile = profilePath(provider);
const CONTENT_TYPES: Record<string, string> = {
  ".css": "text/css; charset=utf-8",
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".png": "image/png",
  ".svg": "image/svg+xml",
  ".wasm": "application/wasm",
  ".webp": "image/webp",
  ".woff2": "font/woff2",
};

mkdirSync(profile, { recursive: true });
const appPidFile = join(profile, "provider-live-app-pid");
if (existsSync(appPidFile)) {
  const pid = Number(readFileSync(appPidFile, "utf8"));
  try {
    const command = execFileSync("ps", ["-p", String(pid), "-o", "command="], { encoding: "utf8" });
    if (command.includes(`--user-data-dir=${profile}`)) process.kill(-pid, "SIGKILL");
  } catch {}
}
writeFileSync(
  join(profile, "openbot-setup-v2.json"),
  `${JSON.stringify({ version: 2, preferredProvider: provider, completedAt: new Date().toISOString() })}\n`,
);

function freePort(): Promise<number> {
  return new Promise((done, fail) => {
    const probe = createNetServer();
    probe.once("error", fail);
    probe.listen(0, RENDERER_HOST, () => {
      const address = probe.address();
      probe.close(() => (address && typeof address === "object" ? done(address.port) : fail(new Error("No port."))));
    });
  });
}

const debuggingPort = await freePort();
const rendererUrl = `http://${RENDERER_HOST}:${rendererPort}`;

interface DevToolsTarget {
  id?: unknown;
  type?: unknown;
  url?: unknown;
  webSocketDebuggerUrl?: unknown;
}

function isMainWindowUrl(url: unknown): boolean {
  return typeof url === "string" && URL.canParse(url) && new URL(url).pathname === "/";
}

function isTrueInPage(socketUrl: string, expression: string): Promise<boolean> {
  return new Promise((done) => {
    const socket = new WebSocket(socketUrl);
    const finish = (value: boolean): void => {
      socket.close();
      done(value);
    };
    socket.addEventListener("open", () =>
      socket.send(JSON.stringify({ id: 1, method: "Runtime.evaluate", params: { expression, returnByValue: true } })),
    );
    socket.addEventListener("message", (event) => {
      const message: { id?: number; result?: { result?: { value?: unknown } } } = JSON.parse(String(event.data));
      if (message.id === 1) finish(message.result?.result?.value === true);
    });
    socket.addEventListener("error", () => finish(false));
  });
}

let mainTargetId: string | null = null;

async function mainWindowLoaded(): Promise<boolean> {
  try {
    const response = await fetch(`http://${RENDERER_HOST}:${debuggingPort}/json/list`);
    const targets: DevToolsTarget[] = await response.json();
    const main = targets.find((target) => target.type === "page" && isMainWindowUrl(target.url));
    if (typeof main?.webSocketDebuggerUrl !== "string" || typeof main.id !== "string") return false;
    const loaded = await isTrueInPage(
      main.webSocketDebuggerUrl,
      "document.readyState === 'complete' && document.getElementById('root')?.childElementCount > 0",
    );
    if (loaded) mainTargetId = main.id;
    return loaded;
  } catch {
    return false;
  }
}

const server = createServer((request, response) => {
  const url = new URL(request.url ?? "/", rendererUrl);
  if (url.pathname === "/__ready") {
    void mainWindowLoaded().then((ready) => {
      response.statusCode = ready ? 200 : 503;
      response.end();
    });
    return;
  }
  const filePath = resolve(rendererRoot, `.${decodeURIComponent(url.pathname === "/" ? "/index.html" : url.pathname)}`);
  if (relative(rendererRoot, filePath).startsWith("..")) {
    response.statusCode = 404;
    response.end();
    return;
  }
  try {
    const body = readFileSync(filePath);
    response.setHeader("content-type", CONTENT_TYPES[extname(filePath)] ?? "application/octet-stream");
    response.end(body);
  } catch {
    response.statusCode = 404;
    response.end();
  }
});

interface DevToolsMessage {
  id?: number;
  method?: string;
  sessionId?: string;
  params?: { sessionId?: string; targetInfo?: { type?: string; targetId?: string } };
}

const devTools = new WebSocketServer({ server, path: DEVTOOLS_PATH });
devTools.on("connection", (client) => {
  const hidden = new Set<string>();
  const waiting: string[] = [];
  let ownId = 0;
  const upstream = fetch(`http://${RENDERER_HOST}:${debuggingPort}/json/version`)
    .then((response) => response.json())
    .then((version: { webSocketDebuggerUrl: string }) => {
      const socket = new Socket(version.webSocketDebuggerUrl);
      socket.on("message", (data) => {
        const text = data.toString();
        const message: DevToolsMessage = JSON.parse(text);
        if (message.id !== undefined && message.id < 0) return;
        if (message.sessionId !== undefined && hidden.has(message.sessionId)) return;
        const attached = message.method === "Target.attachedToTarget" ? message.params : undefined;
        if (
          attached?.sessionId &&
          attached.targetInfo?.type === "page" &&
          attached.targetInfo.targetId !== mainTargetId
        ) {
          hidden.add(attached.sessionId);
          ownId -= 1;
          socket.send(
            JSON.stringify({ id: ownId, sessionId: attached.sessionId, method: "Runtime.runIfWaitingForDebugger" }),
          );
          ownId -= 1;
          socket.send(
            JSON.stringify({ id: ownId, method: "Target.detachFromTarget", params: { sessionId: attached.sessionId } }),
          );
          return;
        }
        if (
          message.method === "Target.detachedFromTarget" &&
          message.params?.sessionId &&
          hidden.has(message.params.sessionId)
        ) {
          return;
        }
        client.send(text);
      });
      socket.on("close", () => client.close());
      socket.on("error", () => client.close());
      return new Promise<Socket>((done) => socket.once("open", () => done(socket)));
    });
  void upstream.then((socket) => {
    for (const text of waiting.splice(0)) socket.send(text);
  });
  upstream.catch(() => client.close());
  let open = false;
  void upstream.then(() => {
    open = true;
  });
  client.on("message", (data) => {
    const text = data.toString();
    if (open) void upstream.then((socket) => socket.send(text));
    else waiting.push(text);
  });
  client.on("close", () => void upstream.then((socket) => socket.close()).catch(() => undefined));
});
await new Promise<void>((done) => server.listen(rendererPort, RENDERER_HOST, done));

const electronRoot = join(PROJECT_ROOT, "node_modules", "electron");
const electron = join(electronRoot, "dist", readFileSync(join(electronRoot, "path.txt"), "utf8").trim());
const app = spawn(
  electron,
  [PROJECT_ROOT, `--user-data-dir=${profile}`, ...(process.platform === "darwin" ? ["--use-mock-keychain"] : [])],
  {
    cwd: PROJECT_ROOT,
    env: {
      ...withoutElectronRuntimeFlags(process.env),
      ELECTRON_RENDERER_URL: rendererUrl,
      OPENBOT_DEV_REMOTE_DEBUGGING_PORT: String(debuggingPort),
      OPENBOT_DEV_REMOTE_ROLE: "host",
      OPENBOT_DEV_HOST_EMAIL: `openbot-live-${provider}@example.com`,
    },
    stdio: "inherit",
    detached: true,
  },
);
writeFileSync(appPidFile, String(app.pid));
writeFileSync(join(profile, DEVTOOLS_ENDPOINT_FILE), `ws://${RENDERER_HOST}:${rendererPort}${DEVTOOLS_PATH}`);
writeFileSync(join(profile, DEBUGGING_PORT_FILE), String(debuggingPort));

function stop(): void {
  server.close();
  if (app.pid === undefined || app.exitCode !== null) return;
  try {
    process.kill(-app.pid, "SIGKILL");
  } catch {}
}
process.once("SIGINT", stop);
process.once("SIGTERM", stop);
app.once("exit", (code) => {
  server.close();
  process.exitCode = code ?? 1;
});
