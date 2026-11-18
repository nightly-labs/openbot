// Checks the smaller copies of picture attachments (`attachment-previews-v1`) with the real Electron
// decoder. The Team API routes E2E runs in Bun, where `nativeImage` does not exist, so it checks the
// route with a stand-in decoder; this run checks the decode itself. It builds
// `attachment-previews-electron.ts`, runs it in Electron on a temporary profile, and checks its report:
// 1. A 12 MP JPEG with EXIF orientation 6 gives an upright 576 x 768 JPEG with no EXIF data, and the
//    large copy is 1536 x 2048.
// 2. The same copy again comes from the cache on disk; a file with a new change time gets a new copy.
// 3. A PNG with transparency stays a PNG; an opaque PNG and a small JPEG give a JPEG.
// 4. A text file, a PNG that says it has 400 million pixels and a damaged JPEG give no copy.
// 5. A cache folder that cannot be written still gives the copy, and the cache stays within its budget.
// Run: `bun run test:attachment-previews`. Writes .openbot-build/attachment-previews-e2e/report.json.
import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { mkdir, mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { z } from "zod";
import { withoutElectronRuntimeFlags } from "./electron-spawn-env";

/** The case count of `attachment-previews-electron.ts`. A case that stops running fails the check. */
const PREVIEW_CASES = 10;

const projectRoot = dirname(dirname(fileURLToPath(import.meta.url)));
const buildRoot = await mkdtemp(join(tmpdir(), "openbot-attachment-previews-"));
const reportPath = join(projectRoot, ".openbot-build/attachment-previews-e2e/report.json");
const runId = randomUUID();
try {
  await mkdir(dirname(reportPath), { recursive: true });
  await rm(reportPath, { force: true });
  const entry = join(buildRoot, "attachment-previews.mjs");
  await run(process.execPath, [
    "build",
    join(projectRoot, "scripts/attachment-previews-electron.ts"),
    "--target=node",
    "--format=esm",
    "--external=electron",
    `--outfile=${entry}`,
  ]);
  await run(
    join(projectRoot, "node_modules/.bin/electron"),
    [
      ...(process.platform === "linux" ? ["--no-sandbox"] : []),
      entry,
      `--fixture-root=${buildRoot}`,
      `--report-path=${reportPath}`,
      `--run-id=${runId}`,
    ],
    true,
  );
  const report = z
    .object({ status: z.literal("passed"), runId: z.literal(runId), cases: z.array(z.string()).length(PREVIEW_CASES) })
    .loose()
    .parse(JSON.parse(await readFile(reportPath, "utf8")));
  process.stdout.write(
    `${JSON.stringify({ status: report.status, cases: report.cases.length, report: reportPath })}\n`,
  );
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
    const timeout = setTimeout(() => {
      child.kill("SIGTERM");
      force = setTimeout(() => child.kill("SIGKILL"), 3_000);
    }, 120_000);
    child.once("error", (error) => {
      clearTimeout(timeout);
      clearTimeout(force);
      reject(error);
    });
    child.once("exit", (code, signal) => {
      clearTimeout(timeout);
      clearTimeout(force);
      if (code === 0 && signal === null) resolve();
      else reject(new Error(`Attachment preview process failed (${code ?? signal}).`));
    });
  });
}
