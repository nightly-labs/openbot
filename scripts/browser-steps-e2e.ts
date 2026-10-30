import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { z } from "zod";
import { withoutElectronRuntimeFlags } from "./electron-spawn-env";

class FixtureProcessTimeout extends Error {}

const projectRoot = dirname(dirname(fileURLToPath(import.meta.url)));
const buildRoot = await mkdtemp(join(tmpdir(), "openbot-browser-steps-"));
const reportPath = join(projectRoot, ".openbot-build/browser-steps-e2e/report.json");
const runId = randomUUID();
let sourceSha: string | undefined;
try {
  await mkdir(dirname(reportPath), { recursive: true });
  // The QuickJS sandbox loads its WebAssembly file next to its own module, so it stays in
  // node_modules, and the entry sits in the project to resolve it.
  const entry = join(dirname(reportPath), "browser-steps.mjs");
  await run(process.execPath, [
    "build",
    join(projectRoot, "scripts/browser-steps-electron.ts"),
    "--target=node",
    "--format=esm",
    "--external=electron",
    "--external=quickjs-emscripten-core",
    "--external=@jitl/quickjs-wasmfile-release-sync",
    `--outfile=${entry}`,
  ]);
  sourceSha = (await output("git", ["rev-parse", "HEAD"])).trim();
  const bunVersion = await output(process.execPath, ["--version"]);
  await run(
    join(projectRoot, "node_modules/.bin/electron"),
    [
      ...(process.platform === "linux" ? ["--no-sandbox"] : []),
      entry,
      `--fixture-root=${buildRoot}`,
      `--report-path=${reportPath}`,
      `--source-sha=${sourceSha}`,
      `--run-id=${runId}`,
      `--harness-runtime=${process.version}`,
      `--bun-version=${bunVersion.trim()}`,
    ],
    true,
  );
  const report = z
    .object({
      status: z.literal("passed"),
      cases: z.array(z.string()).min(25),
      runId: z.literal(runId),
      sourceSha: z.literal(sourceSha),
    })
    .parse(JSON.parse(await readFile(reportPath, "utf8")));
  // Machine-readable summary of the completed case count.
  process.stdout.write(
    `${JSON.stringify({ status: report.status, cases: report.cases.length, report: reportPath })}\n`,
  );
} catch (error) {
  let completedCases: string[] = [];
  let nativeFailure = false;
  try {
    const current = z
      .object({ runId: z.literal(runId), status: z.string(), cases: z.array(z.string()).optional() })
      .parse(JSON.parse(await readFile(reportPath, "utf8")));
    completedCases = current.cases ?? [];
    nativeFailure = current.status === "failed";
  } catch {
    // This invocation owns no valid report yet. An earlier report cannot supply its result.
  }
  if (error instanceof FixtureProcessTimeout) {
    await writeFile(
      reportPath,
      `${JSON.stringify(
        {
          status: "timed_out",
          runId,
          sourceSha,
          cases: completedCases,
          reason: "Owned fixture exceeded its 180-second process guard.",
        },
        null,
        2,
      )}\n`,
    );
  } else if (!nativeFailure) {
    await writeFile(
      reportPath,
      `${JSON.stringify(
        {
          status: "failed",
          runId,
          sourceSha,
          cases: completedCases,
          reason: "Fixture process completion or report verification failed.",
        },
        null,
        2,
      )}\n`,
    );
  }
  throw error;
} finally {
  await rm(buildRoot, { recursive: true, force: true });
}

async function run(command: string, args: string[], electron = false): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    const child = spawn(command, args, {
      cwd: projectRoot,
      stdio: "inherit",
      env: electron ? withoutElectronRuntimeFlags(process.env) : process.env,
    });
    let force: NodeJS.Timeout | undefined;
    let timedOut = false;
    const timeout = setTimeout(() => {
      timedOut = true;
      child.kill("SIGTERM");
      force = setTimeout(() => child.kill("SIGKILL"), 3_000);
    }, 180_000);
    child.once("error", (error) => {
      clearTimeout(timeout);
      clearTimeout(force);
      reject(error);
    });
    child.once("exit", (code, signal) => {
      clearTimeout(timeout);
      clearTimeout(force);
      if (timedOut) reject(new FixtureProcessTimeout("Browser steps fixture timed out."));
      else if (code === 0 && signal === null) resolve();
      else reject(new Error(`Browser steps fixture process failed (${code}).`));
    });
  });
}

async function output(command: string, args: string[]): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { cwd: projectRoot, stdio: ["ignore", "pipe", "inherit"] });
    let text = "";
    child.stdout.on("data", (chunk: Buffer) => {
      text += chunk.toString("utf8");
    });
    child.once("error", reject);
    child.once("exit", (code) =>
      code === 0 ? resolve(text) : reject(new Error("Unable to read fixture source SHA.")),
    );
  });
}
