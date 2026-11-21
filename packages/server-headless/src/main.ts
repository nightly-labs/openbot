// @openbot/server-headless — milestone 2: the repository's own server modules under Bun.
//
// With the electron cache shim (see README), this entry now runs the REAL
// CentralAuthManager (obk1 session), the REAL secret-storage-cipher (file key), and
// the REAL ServerMode (control socket with the /v1 routes). The host surface is a
// minimal adapter until HostService wiring lands. No Xvfb, no dbus, no keyring, no
// window: the process stays what Bun needs and nothing more.
//
// Safety: defaults to a test userData, never the real ~/.config/OpenBot, so the
// packaged server and this module never fight over one session.

import { homedir } from "node:os";
import { mkdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import { readFileSync } from "node:fs";
import { Effect } from "effect";

const userData = process.env.OPENBOT_HEADLESS_USER_DATA ?? join(homedir(), ".config", "openbot-headless-test");
const socketDir = process.env.OPENBOT_HEADLESS_CONTROL_DIR ?? "/run/openbot-headless-test";
const socketPath = join(socketDir, "control.sock");
process.env.OPENBOT_HEADLESS_USER_DATA = userData;
mkdirSync(userData, { recursive: true });
mkdirSync(socketDir, { mode: 0o700, recursive: true });
rmSync(socketPath, { force: true });

// --- real repository modules (loaded through the electron cache shim) -------------
import { createCentralAuthManager, centralAuthApiUrl } from "../../../src/main/account-service-access";
import { ServerMode } from "../../../src/main/server-mode";
import { HeadlessHostAdapter } from "./headless-host-adapter";

const centralAuth = createCentralAuthManager({ confirmSessionAtStart: false });
const host = new HeadlessHostAdapter();

function memoryLines(): Record<string, string | number> {
  const meminfo = readFileSync("/proc/meminfo", "utf8");
  const available = Number(/^MemAvailable:\s+(\d+)/m.exec(meminfo)?.[1] ?? 0);
  const total = Number(/^MemTotal:\s+(\d+)/m.exec(meminfo)?.[1] ?? 0);
  return {
    memory_level: available > 512 * 1024 ? "ok" : available > 256 * 1024 ? "low" : "critical",
    memory_free_mib: Math.round(available / 1024),
    memory_total_mib: Math.round(total / 1024),
  };
}

const serverMode = new ServerMode({
  environment: { controlSocketPath: socketPath, setupPagePort: null },
  version: "0.0.2-headless",
  centralAuth: centralAuth as never,
  host: host as never,
  memory: {
    level: () => memoryLines().memory_level as "ok" | "low" | "critical",
    sample: () => memoryLines(),
    turnLimit: () => 16,
  },
  onError: (message, error) => console.warn(message, error),
});

const state = await Effect.runPromise(centralAuth.initialize() as never).catch((error) => {
  console.warn("account initialize failed:", String(error));
  return null;
});

await Effect.runPromise(serverMode.listen() as never).catch((error) => {
  console.error("control socket failed:", String(error));
  process.exit(1);
});

console.log(`openbot-headless 0.0.2-headless`);
console.log(`account=${state ? (state as { status: string }).status : "unknown"}`);
console.log(`api=${centralAuthApiUrl()}`);
console.log(`control socket: ${socketPath}`);

for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.once(signal, () => {
    void Effect.runPromise(serverMode.close() as never)
      .catch(() => undefined)
      .finally(() => process.exit(0));
  });
}
