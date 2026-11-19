import { type ChildProcess, spawn, spawnSync } from "node:child_process";
import { rmSync } from "node:fs";
import { join, resolve } from "node:path";
import { readDevStackRecords } from "./dev-automation/stack-registry";
import { withoutElectronRuntimeFlags } from "./electron-spawn-env";
import { BENCH_ENV, BENCH_PROVIDERS, BENCH_TAG, LIVE_PROVIDERS } from "./provider-live/targets";
import { readScriptArguments } from "./script-arguments";

const ROOT = resolve(import.meta.dirname, "..");
const API_START_MS = 180_000;
const POLL_MS = 500;

const parsed = readScriptArguments({
  usage: "Usage: bun scripts/provider-live-e2e.ts [--target=<codex|claude|antigravity|grok>] [--bench]",
  options: { target: { type: "string" }, bench: { type: "boolean" } },
});
if (!parsed) process.exit(0);
const target = parsed.values.target;
const bench = parsed.values.bench === true;
const providers: readonly string[] = bench ? BENCH_PROVIDERS : LIVE_PROVIDERS;
if (target !== undefined && !providers.includes(target))
  throw new Error(`Unknown provider: ${target}. Use one of: ${providers.join(", ")}.`);

const environment = withoutElectronRuntimeFlags(process.env);

async function accountServicePort(): Promise<number | null> {
  for (const record of readDevStackRecords()) {
    if (resolve(record.projectRoot) !== ROOT) continue;
    const port = record.ports.find((entry) => entry.name === "api")?.port;
    if (port === undefined) continue;
    try {
      if ((await fetch(`http://127.0.0.1:${port}/health/live`)).ok) return port;
    } catch {}
  }
  return null;
}

function run(command: string, args: string[], env: NodeJS.ProcessEnv = environment): number {
  return spawnSync(command, args, { cwd: ROOT, env, stdio: "inherit" }).status ?? 1;
}

rmSync(join(ROOT, "scripts/provider-live/.e2e"), { recursive: true, force: true });

let startedService: ChildProcess | null = null;
let exitCode = 1;
try {
  let port = await accountServicePort();
  if (port === null) {
    startedService = spawn(process.execPath, [join(ROOT, "scripts/dev-services.ts"), "api"], {
      cwd: ROOT,
      env: environment,
      stdio: "inherit",
    });
    const deadline = Date.now() + API_START_MS;
    while (port === null) {
      if (startedService.exitCode !== null) throw new Error("The local account service did not start.");
      if (Date.now() > deadline) throw new Error("Timed out: the local account service.");
      await new Promise((done) => setTimeout(done, POLL_MS));
      port = await accountServicePort();
    }
  }

  if (run("bun", ["run", "build"]) !== 0) throw new Error("The desktop app did not build.");
  exitCode = run(
    join(ROOT, "node_modules/.bin/e2e"),
    [
      "run",
      "--config",
      join(ROOT, "scripts/provider-live/e2e.config.ts"),
      ...(target ? ["--target", target] : []),
      ...(bench ? ["--tag", BENCH_TAG] : ["--exclude-tag", BENCH_TAG]),
    ],
    {
      ...environment,
      OPENBOT_AUTH_API_URL: `http://127.0.0.1:${port}`,
      E2E_TELEMETRY_DISABLED: "1",
      ...(bench ? { [BENCH_ENV]: "1" } : {}),
    },
  );
} finally {
  if (startedService?.pid !== undefined) {
    run("bun", [join(ROOT, "scripts/dev-stack.ts"), "stop", `--pid=${startedService.pid}`]);
  }
}
process.exit(exitCode);
