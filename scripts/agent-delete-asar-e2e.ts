// Checks that an agent whose workspace holds a `*.asar` file can be deleted. Electron's `fs` reads such
// a file as a folder, and a recursive `rm` of the workspace then never settles. Builds
// `agent-delete-asar-electron.ts` and runs it in Electron as Node, with the real agent store and database.
// A process guard turns a deletion that never settles into a failure.
// Run: `bun scripts/agent-delete-asar-e2e.ts`. Writes .openbot-build/agent-delete-asar-e2e/report.json.
import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { z } from "zod";
import { withoutElectronRuntimeFlags } from "./electron-spawn-env";

const PROCESS_GUARD_MS = 60_000;

const projectRoot = resolve(import.meta.dirname, "..");
const reportPath = join(projectRoot, ".openbot-build/agent-delete-asar-e2e/report.json");
const electronDist = join(projectRoot, "node_modules/electron/dist");
const buildRoot = await mkdtemp(join(tmpdir(), "openbot-delete-asar-build-"));
const runId = randomUUID();

class ProcessGuardExpired extends Error {}

function run(command: string, args: string[], environment: NodeJS.ProcessEnv): Promise<void> {
  return new Promise((settle, fail) => {
    const child = spawn(command, args, { env: environment, stdio: "inherit" });
    const guard = setTimeout(() => {
      child.kill("SIGKILL");
      fail(new ProcessGuardExpired(`${command} did not exit in ${PROCESS_GUARD_MS / 1000} seconds.`));
    }, PROCESS_GUARD_MS);
    child.once("error", (error) => {
      clearTimeout(guard);
      fail(error);
    });
    child.once("exit", (code) => {
      clearTimeout(guard);
      if (code === 0) settle();
      else fail(new Error(`${command} exited with ${code}.`));
    });
  });
}

try {
  await mkdir(dirname(reportPath), { recursive: true });
  await rm(reportPath, { force: true });
  const entry = join(buildRoot, "agent-delete-asar.mjs");
  await run(
    process.execPath,
    [
      "build",
      join(projectRoot, "scripts/agent-delete-asar-electron.ts"),
      "--target=node",
      "--format=esm",
      "--external=electron",
      `--outfile=${entry}`,
    ],
    process.env,
  );
  await run(
    join(electronDist, process.platform === "darwin" ? "Electron.app/Contents/MacOS/Electron" : "electron"),
    [
      entry,
      `--report-path=${reportPath}`,
      `--archive-path=${join(electronDist, process.platform === "darwin" ? "Electron.app/Contents/Resources" : "resources", "default_app.asar")}`,
      `--run-id=${runId}`,
    ],
    { ...withoutElectronRuntimeFlags(process.env), ELECTRON_RUN_AS_NODE: "1" },
  );
  const report = z
    .object({ status: z.literal("passed"), runId: z.literal(runId), steps: z.array(z.string()).length(4) })
    .parse(JSON.parse(await readFile(reportPath, "utf8")));
  process.stdout.write(
    `${JSON.stringify({ status: report.status, steps: report.steps.length, report: reportPath })}\n`,
  );
} catch (error) {
  if (error instanceof ProcessGuardExpired) {
    await writeFile(reportPath, `${JSON.stringify({ status: "timed_out", runId, reason: error.message }, null, 2)}\n`);
  }
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
} finally {
  await rm(buildRoot, { recursive: true, force: true });
}
