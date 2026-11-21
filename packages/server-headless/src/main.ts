// @openbot/server-headless — milestone 2.1: the repository's own server modules under Bun.
//
// Runs the REAL CentralAuthManager (obk1 session), the REAL secret-storage-cipher
// (file key), and the REAL ServerMode (control socket with the /v1 routes). Memory
// lines replicate the native ServerMemory semantics: bytes for limit/available, the
// 6%/12% thresholds, and the 2/8/16 turn limit by total RAM. The control socket binds
// BEFORE the account initializes, like the native host, so the CLI never waits on the
// account service. The host surface stays a minimal adapter until HostService wiring.
//
// Safety: never point this at the real userData while the Electron server runs.
// Defaults: ~/.config/openbot-headless-test and /run/openbot-headless-test.

import { homedir } from "node:os";
import { existsSync, mkdirSync, readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { request as httpRequest } from "node:http";
import { Effect } from "effect";

const MIB = 1024 * 1024;
const GIB = MIB * 1024;

const userData = process.env.OPENBOT_HEADLESS_USER_DATA ?? join(homedir(), ".config", "openbot-headless-test");
const socketDir = process.env.OPENBOT_HEADLESS_CONTROL_DIR ?? "/run/openbot-headless-test";
const socketPath = join(socketDir, "control.sock");
process.env.OPENBOT_HEADLESS_USER_DATA = userData;

try {
  mkdirSync(userData, { recursive: true });
  mkdirSync(socketDir, { mode: 0o700, recursive: true });
} catch (error) {
  console.error("The server runtime directory is not writable. Run this as the service user.");
  process.exit(1);
}

// Native behavior (server-mode.ts:113-122): refuse to replace a non-socket file, and
// never steal a socket another instance owns — probe it first and refuse if it answers.
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
import { HeadlessHostAdapter } from "./headless-host-adapter";

const centralAuth = createCentralAuthManager({ confirmSessionAtStart: false });
const host = new HeadlessHostAdapter();

// Native ServerMemory semantics (server-memory.ts:96-101 turn limits, :199-204
// thresholds). One meminfo read per status request, cached for a second.
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

const serverMode = new ServerMode({
  environment: { controlSocketPath: socketPath, setupPagePort: null },
  version: "0.0.3-headless",
  centralAuth: centralAuth as never,
  host: host as never,
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

// Native order (application-services.ts:4101-4115): the control socket listens FIRST;
// the account initializes in the background and the manager self-recovers on errors
// (central-auth-manager.ts:2495-2504), so a degraded account API never blocks the CLI.
await Effect.runPromise(serverMode.listen() as never).catch((error) => {
  console.error("The control socket failed:", String(error));
  process.exit(1);
});
console.log(`openbot-headless 0.0.3-headless`);
console.log(`api=${centralAuthApiUrl()}`);
console.log(`control socket: ${socketPath}`);
void Effect.runPromise(centralAuth.initialize() as never)
  .then((state) => console.log(`account=${(state as { status: string } | null)?.status ?? "loading"}`))
  .catch((error) => console.warn("The account did not initialize.", String(error)));

async function shutdown(signal: string): Promise<void> {
  const fail = setTimeout(() => process.exit(0), 5_000);
  fail.unref();
  await Effect.runPromise(serverMode.close() as never).catch(() => undefined);
  await Effect.runPromise(centralAuth.dispose() as never).catch(() => undefined);
  clearTimeout(fail);
  rmSync(socketPath, { force: true });
  process.exit(0);
}

for (const signal of ["SIGINT", "SIGTERM", "SIGHUP"] as const) {
  process.once(signal, () => void shutdown(signal));
}
