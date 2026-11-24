// quality-gates: the headless host must never be a lesser implementation than the
// packaged Electron server. Each gate compares against the native behavior, not a
// wish. Run from the repo root:
//
//   bun packages/server-headless/scripts/quality-gates.ts
//
// Gates (a failure blocks the milestone):
//   1 PIN       Bun is exactly 1.4.5 (the version measured on the reference phone).
//   2 LOAD      every real server module imports under Bun.
//   3 CIPHER    the REAL secret-storage-cipher round-trips the obk1 session.
//   4 RESTORE   the REAL CentralAuthManager restores a synthetic signed_in session.
//   5 BOOT      the control socket answers within 10 s (the packaged host takes ~17 s
//               to the same point; its CLI waits 30 s).
//   6 PARITY    /v1/status carries the native keys, memory in BYTES, turn limit by RAM.
//   7 LATENCY   p50 of 50 GET /v1/status under 10 ms (native measured ~1.6 ms).
//   8 SINGLE    a second instance refuses to steal the control socket.
//   9 SHUTDOWN  SIGTERM removes the socket file and exits non-hanging.
//  10 COUNT     report: native modules reused vs stub adapters (informational).
//  11 CREDENTIALS the REAL ProviderCredentialStore round-trips the encrypted envelope
//               through the file-key cipher and a second instance reloads it.
//  12 TABLES    the REAL shared-table stack (supervisor + the repository's database host
//               entry as a Bun child, stdio protocol) answers create/insert/select.

import { spawn } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync, chmodSync } from "node:fs";
import { join } from "node:path";
import { request as httpRequest } from "node:http";

const BUN = process.execPath;
const ROOT = join(import.meta.dir, "..", "..", "..");
const SRC = join(ROOT, "packages", "server-headless", "src");
const WORK = "/tmp/opencode/headless-gates";
const USER_DATA = join(WORK, "user");
const CONTROL_DIR = WORK;
const SOCKET = join(CONTROL_DIR, "control.sock");

const results: Array<{ gate: string; name: string; pass: boolean; detail: string }> = [];
function report(gate: string, name: string, pass: boolean, detail: string): void {
  results.push({ gate, name, pass, detail });
  console.log(`${pass ? "PASS" : "FAIL"} ${gate} ${name}${detail ? ` — ${detail}` : ""}`);
}

function systemOverhead(name: string, run: () => Promise<string>): Promise<boolean> {
  return run()
    .then(() => true)
    .catch((error) => {
      report(name, name, false, String(error).slice(0, 160));
      return false;
    });
}

rmSync(WORK, { recursive: true, force: true });
mkdirSync(USER_DATA, { recursive: true });
mkdirSync(CONTROL_DIR, { mode: 0o700, recursive: true });

// --- gate 1: Bun pin -------------------------------------------------------------------
report("1 PIN", "Bun is exactly 1.4.5", Bun.version === "1.4.5", `found ${Bun.version}`);

// --- gate 2: every real module loads -----------------------------------------------------
const modules = [
  "server-mode",
  "central-auth-manager",
  "team-api-server",
  "host-service",
  "agent-service",
  "secret-storage-cipher",
  "team-store",
  "automation-server",
];
const loaded: string[] = [];
for (const name of modules) {
  try {
    await import(join(ROOT, "src", "main", `${name}.ts`));
    loaded.push(name);
  } catch {
    // agent-service lives under src/backend
    try {
      await import(join(ROOT, "src", "backend", `${name}.ts`));
      loaded.push(name);
    } catch {
      report("2 LOAD", `${name} imports`, false, "import failed");
    }
  }
}
report("2 LOAD", "all real server modules import", loaded.length === modules.length, `${loaded.length}/${modules.length}`);

// --- gate 3+4: real cipher round-trip and manager restore --------------------------------
await systemOverhead("setup", async () => {
  process.env.OPENBOT_HEADLESS_USER_DATA = USER_DATA;
  const { createSecretStorage } = await import(join(ROOT, "src", "main", "secret-storage-cipher.ts"));
  const { CentralAuthManager } = await import(join(ROOT, "src", "main", "central-auth-manager.ts"));
  const { Effect } = await import("effect");

  const storage = createSecretStorage({ keyPath: join(USER_DATA, "secret-storage.key") });
  const cipher = storage.cipher(() => "unavailable");
  const session = {
    version: 2,
    sessionToken: "gates-synthetic-token",
    teamHostTokens: {},
    user: { id: "g1", email: "gates@example.com", name: null, avatarUrl: null, analyticsEnabled: null },
  };
  const container = (cipher as { encrypt(v: string): Buffer }).encrypt(JSON.stringify(session)).toString("base64");
  writeFileSync(join(USER_DATA, "openbot-central-auth-v1.bin"), container, { mode: 0o600 });
  chmodSync(join(USER_DATA, "openbot-central-auth-v1.bin"), 0o600);
  const back = (cipher as { decrypt(c: Buffer): string }).decrypt(Buffer.from(container, "base64"));
  report("3 CIPHER", "real obk1 cipher round-trips", back === JSON.stringify(session), `${back.length} bytes`);

  const manager = new CentralAuthManager({
    apiUrl: "https://api.openbot.run",
    storagePath: join(USER_DATA, "openbot-central-auth-v1.bin"),
    ...cipher,
    keyringChanged: () => storage.madeKeyFile(),
    confirmSessionAtStart: false,
  } as never);
  const state = (await Effect.runPromise((manager as { initialize(): never }).initialize() as never)) as {
    status: string;
  };
  report("4 RESTORE", "real manager restores signed_in", state?.status === "signed_in", `state=${state?.status}`);
  void CentralAuthManager;
});

// --- gate 11: the real provider credential store (encrypted envelope, file-key) -----------
await systemOverhead("credentials", async () => {
  const { ProviderCredentialStore } = await import(join(ROOT, "src", "main", "provider-credential-store.ts"));
  const { createSecretStorage } = await import(join(ROOT, "src", "main", "secret-storage-cipher.ts"));
  const { Effect } = await import("effect");
  const path = join(USER_DATA, "openbot-provider-credentials-v1.json");
  const cipher = createSecretStorage({ keyPath: join(USER_DATA, "secret-storage.key") }).cipher(() => "unavailable");
  const first = new ProviderCredentialStore(path, cipher);
  await Effect.runPromise((first as { load(): never }).load());
  await Effect.runPromise((first as { set(provider: string, key: string): never }).set("kilo", "gates-key"));
  // A second instance must read the same encrypted envelope through the same file-key,
  // exactly like the packaged server restart would.
  const second = new ProviderCredentialStore(path, cipher);
  await Effect.runPromise((second as { load(): never }).load());
  const read = (second as { get(provider: string): string | null }).get("kilo");
  const status = (second as { status(provider: string): string }).status("kilo");
  report(
    "11 CREDENTIALS",
    "real credential store persists and reloads",
    read === "gates-key" && status === "saved",
    `round-trip=${read === "gates-key"}, status=${status}`,
  );
});

// --- gate 12: the real shared-table stack (supervisor + Bun host child) --------------------
await systemOverhead("tables", async () => {
  const { AgentTables } = await import(join(ROOT, "src", "backend", "agent-data", "agent-tables.ts"));
  const { AgentDatabaseSupervisor } = await import(
    join(ROOT, "src", "backend", "agent-data", "agent-database-supervisor.ts")
  );
  const { spawnAgentDatabaseHostBun } = await import(join(SRC, "headless-database-host.ts"));
  const { Effect } = await import("effect");

  const tables = new (AgentTables as new (options: Record<string, unknown>) => never)({
    sharedRoot: join(USER_DATA, "Shared"),
    supervisor: new (AgentDatabaseSupervisor as new (options: Record<string, unknown>) => never)({
      spawnHost: spawnAgentDatabaseHostBun,
    }),
  });
  const service = tables as unknown as {
    execute: (agentId: string, sql: string, parameters: unknown[]) => never;
    query: (sql: string, parameters: unknown[]) => never;
    dispose: () => void;
  };
  await Effect.runPromise(service.execute("gates-agent", "CREATE TABLE gates_probe (note TEXT NOT NULL)", []));
  await Effect.runPromise(service.execute("gates-agent", "INSERT INTO gates_probe (note) VALUES (?)", ["hello bun host"]));
  const read = (await Effect.runPromise(service.query("SELECT note FROM gates_probe", []))) as {
    ok?: boolean;
    value?: { rows: unknown[][] };
    message?: string;
  };
  const rows = read.value?.rows ?? [];
  report(
    "12 TABLES",
    "real host child (Bun) answers create/insert/select",
    rows.length === 1 && rows[0]?.[0] === "hello bun host",
    `rows=${JSON.stringify(rows)}${read.ok === false ? ` message=${read.message}` : ""}`,
  );
  service.dispose();
});

// --- gates 5-9: live server ---------------------------------------------------------------
async function probe(): Promise<Map<string, string> | null> {
  return new Promise((resolve) => {
    const req = httpRequest({ socketPath: SOCKET, method: "GET", path: "/v1/status", host: "openbot" }, (res) => {
      let text = "";
      res.on("data", (chunk: Buffer) => (text += chunk));
      res.on("end", () => {
        const lines = new Map<string, string>();
        for (const line of text.split("\n")) {
          const eq = line.indexOf("=");
          if (eq > 0) lines.set(line.slice(0, eq), line.slice(eq + 1));
        }
        resolve(lines);
      });
    });
    req.setTimeout(1000, () => {
      req.destroy();
      resolve(null);
    });
    req.on("error", () => resolve(null));
    req.end();
  });
}

await systemOverhead("boot", async () => {
  const env = { ...process.env, OPENBOT_HEADLESS_USER_DATA: USER_DATA, OPENBOT_HEADLESS_CONTROL_DIR: CONTROL_DIR };
  const child = spawn(BUN, [join(SRC, "main.ts")], { env, stdio: ["ignore", "pipe", "pipe"] });
  let output = "";
  child.stdout.on("data", (c: Buffer) => (output += c));
  child.stderr.on("data", (c: Buffer) => (output += c));

  const bootStart = Date.now();
  let status: Map<string, string> | null = null;
  while (Date.now() - bootStart < 10_000) {
    status = await probe();
    if (status) break;
    await new Promise((r) => setTimeout(r, 150));
  }
  const bootMs = Date.now() - bootStart;
  report("5 BOOT", "control socket answers within 10 s", Boolean(status) && bootMs <= 10_000, `${bootMs} ms`);

  if (status) {
    const hasAll = ["version", "account", "server", "memory_level", "memory_limit", "memory_available", "turn_limit"].every(
      (key) => status!.has(key),
    );
    const limitBytes = Number(status.get("memory_limit") ?? 0);
    const turnLimit = Number(status.get("turn_limit") ?? 0);
    const bytesOk = limitBytes > 1_000_000_000; // the native dialect is BYTES, not MiB
    const totalKb = Number(/^MemTotal:\s+(\d+)/m.exec(readFileSync("/proc/meminfo", "utf8"))?.[1] ?? 0);
    const expectedTurn = totalKb > 10 * 1024 * 1024 ? 16 : totalKb > 5 * 1024 * 1024 ? 8 : 2;
    report(
      "6 PARITY",
      "native keys, bytes, turn limit by RAM",
      hasAll && bytesOk && turnLimit === expectedTurn,
      `bytes=${limitBytes} turn=${turnLimit} (expected ${expectedTurn})`,
    );

    // gate 7: latency, 50 sequential requests, connection per request (curl parity).
    const samples: number[] = [];
    for (let i = 0; i < 50; i++) {
      const t0 = performance.now();
      await probe();
      samples.push(performance.now() - t0);
    }
    samples.sort((a, b) => a - b);
    const p50 = samples[25];
    report("7 LATENCY", "p50 of 50 status requests under 10 ms", p50 < 10, `p50=${p50.toFixed(2)} ms`);

    // gate 8: a second instance must refuse to steal the socket.
    const second = spawn(BUN, [join(SRC, "main.ts")], { env, stdio: ["ignore", "ignore", "pipe"] });
    let secondErr = "";
    second.stderr.on("data", (c: Buffer) => (secondErr += c));
    const secondCode = await new Promise<number>((resolve) => second.on("exit", (code) => resolve(code ?? -1)));
    report(
      "8 SINGLE",
      "second instance refuses the live socket",
      secondCode !== 0 && secondErr.includes("already answers"),
      `exit=${secondCode}`,
    );

    // gate 9: SIGTERM removes the socket and the process exits.
    const sigStart = Date.now();
    child.kill("SIGTERM");
    const exitCode = await new Promise<number>((resolve) => child.on("exit", (code) => resolve(code ?? -1)));
    const sigMs = Date.now() - sigStart;
    await new Promise((r) => setTimeout(r, 200));
    report(
      "9 SHUTDOWN",
      "SIGTERM exits fast and removes the socket",
      exitCode === 0 && sigMs < 5000 && !existsSync(SOCKET),
      `exit=${exitCode} in ${sigMs} ms, socket gone=${!existsSync(SOCKET)}`,
    );
  } else {
    report("5 BOOT", "control socket answers within 5 s", false, "no answer");
    report("6 PARITY", "native keys, bytes, turn limit by RAM", false, "skipped");
    report("7 LATENCY", "p50 under 10 ms", false, "skipped");
    report("8 SINGLE", "second instance refuses", false, "skipped");
    report("9 SHUTDOWN", "SIGTERM cleans up", false, "skipped");
    child.kill("SIGKILL");
  }
});

// --- gate 10: adaptation count (informational) --------------------------------------------
await systemOverhead("count", async () => {
  const { readdirSync } = await import("node:fs");
  const ours = readdirSync(SRC).filter((f) => f.endsWith(".ts") || f.endsWith(".cjs"));
  const adapters = ours.filter((f) => /stub|adapter|host-adapter/.test(f));
  report(
    "10 COUNT",
    "native modules reused vs adapters",
    true,
    `${modules.length} native modules reused, ${ours.length} files in src (${adapters.length} adapters: ${adapters.join(", ")})`,
  );
});

const failed = results.filter((r) => !r.pass);
console.log(failed.length === 0 ? "\nALL GATES PASS" : `\n${failed.length} GATE(S) FAILED`);
process.exit(failed.length === 0 ? 0 : 1);
