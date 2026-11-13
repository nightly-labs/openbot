// The app command of `scripts/provider-live/e2e.config.ts`. It starts the built desktop app
// (`bun run build`) for one provider, on its own profile, and serves the built renderer on loopback
// HTTP: the e2e web engine opens only `http(s)` addresses, and the app trusts the address in
// `ELECTRON_RENDERER_URL`. `/__ready` answers 200 when the main window has loaded the renderer.
// `/__devtools` is the DevTools socket for e2e. It shows only the main window: e2e drives the first
// page that it gets, and the app also has helper windows (the agent dock, the host bridge).
// e2e stops this process with a signal; the process then stops the app.
// `bun scripts/provider-live/start-app.ts <provider> <renderer port>`
import { execFileSync, spawn } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { createServer } from "node:http";
import { createServer as createNetServer } from "node:net";
import { extname, join, relative, resolve } from "node:path";
import { WebSocket as Socket, WebSocketServer } from "ws";
import { withoutElectronRuntimeFlags } from "../electron-spawn-env";
import {
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
  throw new Error("Usage: start-app.ts <codex|claude|antigravity> <renderer port>");
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

// The profile stays between runs: it holds the sign-in of the development account, and the local
// account service permits only 5 sign-ins in 15 minutes. The test removes the agents of an earlier run.
mkdirSync(profile, { recursive: true });
// A run that was stopped hard can leave its app. That app holds the profile, and a second app on
// the same profile exits at once. The process is stopped only when its command names this profile.
const appPidFile = join(profile, "provider-live-app-pid");
if (existsSync(appPidFile)) {
  const pid = Number(readFileSync(appPidFile, "utf8"));
  try {
    const command = execFileSync("ps", ["-p", String(pid), "-o", "command="], { encoding: "utf8" });
    if (command.includes(`--user-data-dir=${profile}`)) process.kill(-pid, "SIGKILL");
  } catch {
    // No such process.
  }
}
// First-run setup is complete, so the app opens on the chat and not on onboarding.
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

/** True when one expression is `true` in a page, read through the DevTools socket of the page. */
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

/** The DevTools id of the main window. It stays the same when the window loads another address. */
let mainTargetId: string | null = null;

/**
 * True when the main window has loaded the renderer. e2e moves the window to `about:blank` when it
 * connects; before the first load ends, the app reads that as a failed start and quits.
 */
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

// The DevTools socket of the app, with the helper windows removed. The socket lets each helper
// window run and detaches from it, and e2e gets no message about it.
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
        // The answers to the two commands below.
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

// The Electron binary itself, not the `.bin/electron` Node wrapper.
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
      // Signs a throwaway account in on the local account service, as `bun run dev` does.
      OPENBOT_DEV_REMOTE_ROLE: "host",
      // An account for each provider: the account service permits few sign-ins for one email.
      OPENBOT_DEV_HOST_EMAIL: `openbot-live-${provider}@example.com`,
    },
    stdio: "inherit",
    // Its own process group, so that the stop also ends the provider CLIs that the app started.
    detached: true,
  },
);
writeFileSync(appPidFile, String(app.pid));
// The config reads this file to find the DevTools socket of this provider's app.
writeFileSync(join(profile, DEVTOOLS_ENDPOINT_FILE), `ws://${RENDERER_HOST}:${rendererPort}${DEVTOOLS_PATH}`);

// A hard stop: a soft stop can take a minute, because the app waits for services that this test
// does not start. The test has its answer before the stop, and the profile holds no user data.
function stop(): void {
  server.close();
  if (app.pid === undefined || app.exitCode !== null) return;
  try {
    process.kill(-app.pid, "SIGKILL");
  } catch {
    // The app is gone already.
  }
}
process.once("SIGINT", stop);
process.once("SIGTERM", stop);
app.once("exit", (code) => {
  server.close();
  process.exitCode = code ?? 1;
});
