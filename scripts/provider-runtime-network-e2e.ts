// Builds and starts `scripts/provider-runtime-network-electron.ts` in the real Electron runtime.
// The entry checks Electron's `net.fetch` against a local HTTP server: a normal response, a Request
// body, a Range/If-Range 206 resume, and an AbortSignal. It also checks that `providerRuntimeFetch`
// rejects a non-https URL. System proxy discovery is not covered here.
//
// Run: bun scripts/provider-runtime-network-e2e.ts
// It writes .openbot-build/provider-runtime-network-e2e/report.json and exits non-zero on a failure.
import assert from "node:assert/strict";
import { type ChildProcess, spawn, spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { withoutElectronRuntimeFlags } from "./electron-spawn-env";

const ROOT = resolve(import.meta.dirname, "..");
const OUT = join(ROOT, ".openbot-build", "provider-runtime-network-e2e");
const REPORT = join(OUT, "report.json");
const TIMEOUT_MS = 30_000;
const electronPath = join(
  ROOT,
  "node_modules",
  "electron",
  "dist",
  readFileSync(join(ROOT, "node_modules", "electron", "path.txt"), "utf8").trim(),
);

const root = await mkdtemp(join(tmpdir(), "openbot-provider-network-"));
const bundle = join(root, "provider-runtime-network-electron.mjs");
let child: ChildProcess | undefined;
let error: string | undefined;
let passed = false;

try {
  const build = spawnSync(process.execPath, [
    "build",
    join(ROOT, "scripts", "provider-runtime-network-electron.ts"),
    "--target=node",
    "--format=esm",
    "--external=electron",
    `--outfile=${bundle}`,
  ]);
  assert.equal(build.status, 0, `bun build failed: ${build.stderr.toString()}`);

  child = spawn(electronPath, [bundle, `--report-path=${REPORT}`], {
    env: withoutElectronRuntimeFlags(process.env),
    stdio: ["ignore", "pipe", "inherit"],
  });
  const exitCode = await new Promise<number | null>((resolve, reject) => {
    const timer = setTimeout(() => {
      child?.kill("SIGKILL");
      reject(new Error(`Electron did not finish within ${TIMEOUT_MS} ms.`));
    }, TIMEOUT_MS);
    child?.once("error", (cause) => {
      clearTimeout(timer);
      reject(cause);
    });
    child?.once("exit", (code) => {
      clearTimeout(timer);
      resolve(code);
    });
  });
  assert.equal(exitCode, 0, "Electron exited with a failure");
  const report = JSON.parse(readFileSync(REPORT, "utf8"));
  assert.ok(
    report !== null && typeof report === "object" && "passed" in report && report.passed === true,
    "the Electron report passed",
  );
  passed = true;
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
} catch (cause) {
  error = cause instanceof Error ? cause.message : String(cause);
} finally {
  child?.kill("SIGKILL");
  await rm(root, { recursive: true, force: true });
  await mkdir(OUT, { recursive: true });
  await writeFile(REPORT, `${JSON.stringify({ passed, error }, null, 2)}\n`);
  process.stdout.write(`${passed ? "PASS" : "FAIL"}${error ? `: ${error}` : ""}: report in ${REPORT}\n`);
  if (!passed) process.exitCode = 1;
}
