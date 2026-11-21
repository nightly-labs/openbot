// @openbot-server-headless — milestone 3: the repository's own server + agent stack under Bun.
//
// Runs the REAL CentralAuthManager (obk1 session), the REAL ServerMode (control socket),
// the REAL OpenBotDatabase/AgentStore/MailboxStore (SQLite), the REAL AgentService
// (phase 1: opencode preferred via ACP), the REAL TeamStore and the REAL TeamApiServer
// serving the team routes on 127.0.0.1. No Electron, no Xvfb, no dbus, no keyring, no
// window, no browser (HeadlessBrowserHost refuses every call).
//
// Boot order mirrors the native host (index.ts:1412-1858): the host surface (control
// socket, then team API) listens first; the account and the agent service initialize
// in the background, like the desktop's AgentInitializationGate, so a slow provider
// probe never blocks the CLI.
//
// Safety: never point this at the real userData while the Electron server runs.
// Defaults: ~/.config/openbot-headless-test and /run/openbot-headless-test.

import { homedir } from "node:os";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { request as httpRequest } from "node:http";
import { randomUUID } from "node:crypto";
import { Effect } from "effect";

const MIB = 1024 * 1024;
const GIB = MIB * 1024;

const userData = process.env.OPENBOT_HEADLESS_USER_DATA ?? join(homedir(), ".config", "openbot-headless-test");
const socketDir = process.env.OPENBOT_HEADLESS_CONTROL_DIR ?? "/run/openbot-headless-test";
const socketPath = join(socketDir, "control.sock");
process.env.OPENBOT_HEADLESS_USER_DATA = userData;

// The opencode the phone already runs in ACP today (same binary the packaged server
// uses); bundledExecutables below points the provider resolver at it.
const OPENCODE_BIN =
  process.env.OPENBOT_OPENCODE_PATH ??
  "/var/lib/openbot/.config/OpenBot/provider-runtimes/opencode/linux-arm64/2.2.5/bin/opencode";

try {
  mkdirSync(userData, { recursive: true });
  mkdirSync(socketDir, { mode: 0o700, recursive: true });
} catch {
  console.error("The server runtime directory is not writable. Run this as the service user.");
  process.exit(1);
}

// Native behavior (server-mode.ts:113-122): never steal a socket another instance
// owns — probe it first and refuse if it answers.
if (existsSync(socketPath)) {
  const answered = await new Promise<boolean>((resolve) => {
    const request = httpRequest(
      { socketPath, method: "GET", path: "/v1/status", host: "openbot" },
      (response) => {
        response.resume();
        response.on("end", () => resolve(response.statusCode === 200));
      },
    );
    request.setTimeout(1000, () => {
      request.destroy();
      resolve(false);
    });
    request.on("error", () => resolve(false));
    request.end();
  });
  if (answered) {
    console.error("Another openbot-headless server already answers on this control socket.");
    process.exit(1);
  }
  rmSync(socketPath, { force: true });
}

// --- real repository modules (loaded through the electron cache shim) -------------
import { createCentralAuthManager, centralAuthApiUrl } from "../../../src/main/account-service-access";
import { ServerMode } from "../../../src/main/server-mode";
import { TeamApiServer } from "../../../src/main/team-api-server";
import { TeamStore } from "../../../src/main/team-store";
import { OpenBotDatabase } from "../../../src/backend/openbot-database";
import { AgentStore } from "../../../src/backend/agent-store";
import { MailboxStore } from "../../../src/backend/mailbox-store";
import { AgentService } from "../../../src/backend/agent-service";
import { NO_PROVIDER_CREDENTIALS } from "../../../src/backend/provider-drivers";
import { AGENT_PROVIDERS } from "@openbot/contracts/agent-providers";
import { HeadlessBrowserHost } from "./headless-browser-host";

// --- memory: native ServerMemory semantics (server-memory.ts:96-101, :199-204) ------
let meminfoCache: { at: number; total: number; available: number } | null = null;
function readMemory(): { total: number; available: number } {
  const now = Date.now();
  if (meminfoCache && now - meminfoCache.at < 1000) {
    return { total: meminfoCache.total, available: meminfoCache.available };
  }
  const text = readFileSync("/proc/meminfo", "utf8");
  const total = Number(/^MemTotal:\s+(\d+)/m.exec(text)?.[1] ?? 0) * 1024;
  const available = Number(/^MemAvailable:\s+(\d+)/m.exec(text)?.[1] ?? 0) * 1024;
  meminfoCache = { at: now, total, available };
  return { total, available };
}

function memoryLevel(): "ok" | "low" | "critical" {
  const { total, available } = readMemory();
  const critical = Math.max(256 * MIB, total * 0.06);
  const low = Math.max(critical + 64 * MIB, total * 0.12, Math.min(512 * MIB, total * 0.2));
  if (available <= critical) return "critical";
  if (available <= low) return "low";
  return "ok";
}

function turnLimit(): 2 | 8 | 16 {
  const { total } = readMemory();
  if (total <= 5 * GIB) return 2;
  if (total <= 10 * GIB) return 8;
  return 16;
}

// HostMemory contract (src/backend/host-memory.ts): subscribe/reserveTurn included so
// the real AgentService accepts it.
const hostMemory = {
  hostedPlan: false,
  level: () => memoryLevel(),
  turnLimit: () => turnLimit(),
  reserveTurn: () => () => undefined,
  subscribe: () => () => undefined,
};

// --- account (real manager) ------------------------------------------------------------
const centralAuth = createCentralAuthManager({ confirmSessionAtStart: false });

// --- database, roster and mailbox (real SQLite stores) -------------------------------
const database = new OpenBotDatabase(userData);
const store = new AgentStore(userData, homedir(), database);
await Effect.runPromise(store.initialize() as never).catch((error) => {
  console.error("The agent store did not initialize.", String(error));
  process.exit(1);
});
const mailbox = new MailboxStore(userData, store.sharedRoot, database);

// --- agents (real service, phase 1: opencode over ACP, no credentials yet) -----------
const browser = new HeadlessBrowserHost();
const agentService = new AgentService({
  store,
  mailbox,
  browser,
  preferredProvider: "opencode",
  credentials: NO_PROVIDER_CREDENTIALS,
  bundledExecutables: { opencode: existsSync(OPENCODE_BIN) ? OPENCODE_BIN : null },
  offProviders: AGENT_PROVIDERS.filter((provider) => provider !== "opencode"),
  tables: null,
  hostMemory,
  hostTurnLimits: { turnLimit: () => turnLimit(), agentTaskLimit: () => 16 },
} as never);

// --- team identity (real store) --------------------------------------------------------
const teamStore = new TeamStore(join(userData, "openbot-team-server-v2.json"), null);
await Effect.runPromise(teamStore.initialize() as never).catch((error) =>
  console.warn("The team store did not initialize.", String(error)),
);
if (!teamStore.configured) {
  const credentialsPath = join(userData, "openbot-headless-owner.json");
  let owner: { username: string; password: string };
  if (existsSync(credentialsPath)) {
    owner = JSON.parse(readFileSync(credentialsPath, "utf8")) as { username: string; password: string };
  } else {
    owner = { username: "owner", password: randomUUID().replaceAll("-", "") };
    writeFileSync(credentialsPath, JSON.stringify(owner), { mode: 0o600 });
  }
  await Effect.runPromise(teamStore.configure("openbot-headless-test", owner.username, owner.password) as never).catch(
    (error) => {
      console.error("The team identity did not configure.", String(error));
      process.exit(1);
    },
  );
}

// --- team API (real server, loopback; port known after start) --------------------------
let teamApiPort: number | null = null;
const teamApi = new TeamApiServer({
  appVersion: "0.0.3-headless",
  store: teamStore,
  agents: agentService as never,
  mailbox: mailbox as never,
  browser: browser as never,
} as never);

// --- control socket (real ServerMode) --------------------------------------------------
// Host status mirrors the native shape: online with the loopback apiUrl once the team
// API serves; signed_out before that.
const hostStatus = () => ({
  phase: teamApiPort ? ("online" as const) : ("signed_out" as const),
  configured: teamStore.configured,
  enabledOnLaunch: false,
  serverId: teamStore.getIdentity()?.serverId ?? null,
  serverName: teamStore.getIdentity()?.serverName ?? null,
  apiUrl: teamApiPort ? `http://localhost:${teamApiPort}` : null,
  logoUrl: null,
  appearance: null,
  apiOnline: Boolean(teamApiPort),
  remoteDesktopReady: false,
  remoteDesktopScreenRecordingDenied: false,
  remoteDesktopUnattended: false,
  remoteDesktopActiveSessions: 0,
  remoteDesktopMaxSessions: 0,
  message: teamApiPort
    ? "headless host: team API on loopback; no WebRTC bridge yet"
    : "headless host: agent service not wired yet",
});

const serverMode = new ServerMode({
  environment: { controlSocketPath: socketPath, setupPagePort: null },
  version: "0.0.3-headless",
  centralAuth: centralAuth as never,
  host: {
    getStatus: hostStatus,
    configure: async () => {
      // TODO: delegate to TeamStore identity update + account registration.
    },
    start: async () => {
      // The team API already serves loopback; remote publish needs the WebRTC bridge.
    },
    updateIdentity: async () => {},
    getMobileConnectHost: async () => null,
    refreshRegistration: async () => {},
  } as never,
  memory: {
    level: () => memoryLevel(),
    sample: () => {
      const { total, available } = readMemory();
      return { total, available };
    },
    turnLimit: () => turnLimit(),
  },
  onError: (message, error) => console.warn(message, error),
});

// Native order: control socket first, then team API, then background initialization.
await Effect.runPromise(serverMode.listen() as never).catch((error) => {
  console.error("The control socket failed:", String(error));
  process.exit(1);
});
console.log(`openbot-headless 0.0.3-headless`);
console.log(`api=${centralAuthApiUrl()}`);
console.log(`control socket: ${socketPath}`);
teamApiPort = await Effect.runPromise(teamApi.start() as never).catch((error) => {
  console.warn("The team API did not start.", String(error));
  return null;
});
if (teamApiPort) console.log(`team api: http://localhost:${teamApiPort}`);
void Effect.runPromise(centralAuth.initialize() as never)
  .then((state) => console.log(`account=${(state as { status: string } | null)?.status ?? "loading"}`))
  .catch((error) => console.warn("The account did not initialize.", String(error)));
void Effect.runPromise(agentService.initialize() as never)
  .then(() => console.log("agents=ready"))
  .catch((error) =>
    console.warn(
      "The agent service did not initialize fully.",
      error instanceof Error ? `${error}\ncause: ${String((error as { cause?: unknown }).cause)}` : String(error),
    ),
  );

async function shutdown(signal: string): Promise<void> {
  const fail = setTimeout(() => process.exit(0), 5_000);
  fail.unref();
  await Effect.runPromise(teamApi.stop() as never).catch(() => undefined);
  await Effect.runPromise(serverMode.close() as never).catch(() => undefined);
  await Effect.runPromise(centralAuth.dispose() as never).catch(() => undefined);
  clearTimeout(fail);
  rmSync(socketPath, { force: true });
  process.exit(0);
}

for (const signal of ["SIGINT", "SIGTERM", "SIGHUP"] as const) {
  process.once(signal, () => void shutdown(signal));
}
