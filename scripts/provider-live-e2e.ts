// The live provider test: one real turn on Codex, Claude and Gemini, each in its own
// desktop app, at the same time. The e2e framework (https://e2e.com/docs) is the runner; it drives
// each app window through the DevTools port. See docs/provider-live-e2e.md.
//
// Each provider uses the sign-in of the user who runs the test, and each run sends two short
// messages to each provider.
// `bun run test:provider-live`; `--target=<codex|claude|antigravity>` runs one provider.
// Writes scripts/provider-live/.e2e/report.json, summary.md, junit.xml and a trace for each test.
import { type ChildProcess, spawn, spawnSync } from "node:child_process";
import { join, resolve } from "node:path";
import { readDevStackRecords } from "./dev-automation/stack-registry";
import { withoutElectronRuntimeFlags } from "./electron-spawn-env";
import { isLiveProvider } from "./provider-live/targets";
import { readScriptArguments } from "./script-arguments";

const ROOT = resolve(import.meta.dirname, "..");
const API_START_MS = 180_000;
const POLL_MS = 500;

const parsed = readScriptArguments({
  usage: "Usage: bun scripts/provider-live-e2e.ts [--target=<codex|claude|antigravity>]",
  options: { target: { type: "string" } },
});
if (!parsed) process.exit(0);
const target = parsed.values.target;
if (target !== undefined && !isLiveProvider(target)) throw new Error(`Unknown provider: ${target}`);

const environment = withoutElectronRuntimeFlags(process.env);

/** The port of the local account service of this worktree, when it runs and answers. */
async function accountServicePort(): Promise<number | null> {
  const stack = readDevStackRecords().find((record) => resolve(record.projectRoot) === ROOT);
  const port = stack?.ports.find((entry) => entry.name === "api")?.port;
  if (port === undefined) return null;
  try {
    return (await fetch(`http://127.0.0.1:${port}/health/live`)).ok ? port : null;
  } catch {
    return null;
  }
}

function run(command: string, args: string[], env: NodeJS.ProcessEnv = environment): number {
  return spawnSync(command, args, { cwd: ROOT, env, stdio: "inherit" }).status ?? 1;
}

let startedService: ChildProcess | null = null;
let exitCode = 1;
try {
  // The app signs a development account in on the local account service. It starts with no secrets.
  let port = await accountServicePort();
  if (port === null) {
    startedService = spawn("bun", [join(ROOT, "scripts/dev-services.ts"), "api"], {
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
    ["run", "--config", join(ROOT, "scripts/provider-live/e2e.config.ts"), ...(target ? ["--target", target] : [])],
    { ...environment, OPENBOT_AUTH_API_URL: `http://127.0.0.1:${port}`, E2E_TELEMETRY_DISABLED: "1" },
  );
} finally {
  // Only the service that this run started. `dev:stop` stops the stack of this worktree.
  if (startedService) run("bun", [join(ROOT, "scripts/dev-stack.ts"), "stop"]);
}
process.exit(exitCode);
