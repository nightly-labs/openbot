import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { z } from "zod";
import { withoutElectronRuntimeFlags } from "./electron-spawn-env";

const projectRoot = dirname(dirname(fileURLToPath(import.meta.url)));
const outputRoot = join(projectRoot, ".openbot-build/signal-revoked-session-e2e");
const reportPath = join(outputRoot, "report.json");
const pageRoot = join(outputRoot, "page");
const entry = join(outputRoot, "signal-revoked-session-electron.mjs");
const runId = randomUUID();
const PROCESS_GUARD_MS = 12 * 60_000;

await mkdir(pageRoot, { recursive: true });
await run(process.execPath, [
  "build",
  join(projectRoot, "scripts/signal-revoked-session-page.ts"),
  "--target=browser",
  "--format=iife",
  `--outfile=${join(pageRoot, "page.js")}`,
]);
await writeFile(
  join(pageRoot, "index.html"),
  '<!doctype html><html lang="en"><head><meta charset="UTF-8" /><title>Signal revoked session E2E</title></head><body><script src="page.js"></script></body></html>\n',
);
await run(process.execPath, [
  "build",
  join(projectRoot, "scripts/signal-revoked-session-electron.ts"),
  "--target=node",
  "--format=esm",
  "--external=electron",
  `--outfile=${entry}`,
]);
const exitCode = await run(
  join(projectRoot, "node_modules/.bin/electron"),
  [
    ...(process.platform === "linux" ? ["--no-sandbox"] : []),
    entry,
    `--project-root=${projectRoot}`,
    `--page=${join(pageRoot, "index.html")}`,
    `--report-path=${reportPath}`,
    `--run-id=${runId}`,
  ],
  true,
);
const report = z
  .object({
    status: z.enum(["passed", "failed"]),
    runId: z.literal(runId),
    checks: z.array(z.object({ name: z.string(), passed: z.boolean(), evidence: z.string() })),
  })
  .parse(JSON.parse(await readFile(reportPath, "utf8")));
process.stdout.write(
  `${JSON.stringify({ status: report.status, passed: report.checks.filter((check) => check.passed).length, checks: report.checks.length, report: reportPath })}\n`,
);
if (exitCode !== 0 || report.status !== "passed") process.exit(1);

function run(command: string, args: string[], electron = false): Promise<number> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd: projectRoot,
      stdio: "inherit",
      env: electron ? withoutElectronRuntimeFlags(process.env) : process.env,
    });
    const guard = setTimeout(() => child.kill("SIGKILL"), PROCESS_GUARD_MS);
    child.once("error", (error) => {
      clearTimeout(guard);
      reject(error);
    });
    child.once("exit", (code) => {
      clearTimeout(guard);
      if (!electron && code !== 0) reject(new Error(`${command} failed (${code}).`));
      else resolve(code ?? 1);
    });
  });
}
