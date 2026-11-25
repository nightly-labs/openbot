import { spawn } from "node:child_process";
import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { join, resolve } from "node:path";
import { createOpenBotLogger } from "@openbot/logging";

const logger = createOpenBotLogger("process-launcher-e2e");
const OUTPUT = resolve(".openbot-build/process-launcher-e2e");
const BUNDLE = join(OUTPUT, "bundle");
const REPORT = join(OUTPUT, "report.json");
const ELECTRON = String(createRequire(import.meta.url)("electron"));

async function bundle(entry: string, name: string): Promise<void> {
  const result = await Bun.build({
    entrypoints: [resolve(entry)],
    outdir: BUNDLE,
    naming: `${name}.cjs`,
    target: "node",
    format: "cjs",
    external: ["electron"],
  });
  if (!result.success) throw new Error(result.logs.map(String).join("\n"));
}

function runElectron(): Promise<number | null> {
  const env: NodeJS.ProcessEnv = {
    ...process.env,
    PROCESS_LAUNCHER_E2E_REPORT: REPORT,
    PROCESS_LAUNCHER_E2E_HOST: join(BUNDLE, "process-launcher-host.cjs"),
  };
  delete env.ELECTRON_RUN_AS_NODE;
  return new Promise((resolveExit, reject) => {
    const child = spawn(ELECTRON, [BUNDLE], { env, stdio: ["ignore", "inherit", "inherit"] });
    const deadline = setTimeout(() => child.kill("SIGKILL"), 120_000);
    child.once("error", reject);
    child.once("exit", (code) => {
      clearTimeout(deadline);
      resolveExit(code);
    });
  });
}

interface Outcome {
  stdout: string;
  stdoutBytes: number;
  stderr: string;
  exit: { code: number | null; signal: string | null } | null;
  error: { message: string; code: string | null } | null;
  exitAfterError: boolean;
}

interface Timing {
  mainThreadBlockingMs: { p50: number; p95: number; max: number };
  firstOutputMs: { p50: number; p95: number; max: number };
}

interface Report {
  failure?: string;
  hostStarts: number;
  echo: Outcome;
  kill: Outcome & { killAccepted: boolean; killedFlag: boolean };
  missing: Outcome;
  large: Outcome & { expectedBytes: number };
  hostLoss: Outcome;
  afterHostLoss: Outcome;
  fallback: Outcome;
  timing: { launcher: Timing; direct: Timing };
}

rmSync(OUTPUT, { recursive: true, force: true });
mkdirSync(BUNDLE, { recursive: true });
writeFileSync(join(BUNDLE, "package.json"), JSON.stringify({ name: "process-launcher-e2e", main: "main.cjs" }));
await bundle("src/main/process-launcher-host.ts", "process-launcher-host");
await bundle("scripts/process-launcher-e2e-main.ts", "main");
const exitCode = await runElectron();
const report: Report = JSON.parse(readFileSync(REPORT, "utf8"));
if (report.failure) throw new Error(report.failure);

const checks: Array<[string, boolean]> = [
  ["Electron exited cleanly", exitCode === 0],
  ["stdin reaches the program and stdout comes back", report.echo.stdout === "HELLO LAUNCHER"],
  ["stderr comes back", report.echo.stderr === "stderr:14"],
  ["exit code comes back", report.echo.exit?.code === 7],
  [
    "kill ends the program",
    report.kill.killAccepted && report.kill.killedFlag && report.kill.exit?.signal === "SIGTERM",
  ],
  ["a missing program gives an error", report.missing.error?.code === "ENOENT"],
  ["a missing program gives no exit event", report.missing.exit === null],
  ["5 MB of output arrives complete", report.large.stdoutBytes === report.large.expectedBytes],
  ["a lost host ends its programs", report.hostLoss.exit?.signal === "SIGKILL"],
  ["the next launch starts a new host", report.afterHostLoss.exit?.code === 3 && report.hostStarts === 2],
  ["a host that cannot start falls back to a direct start", report.fallback.stdout === "FALLBACK"],
];

for (const [name, passed] of checks) logger.info(`${passed ? "pass" : "FAIL"}  ${name}`);
logger.info("Timing", report.timing);
logger.info(`Report: ${REPORT}`);
if (checks.some(([, passed]) => !passed)) process.exit(1);
