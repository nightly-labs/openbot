// Builds capture-electron.ts and runs it under the repository's Electron, as scripts/browser-smoke.ts does.
// Usage: bun research/670-typed-decisions/capture-snapshots.ts
import { spawn } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { withoutElectronRuntimeFlags } from "../../scripts/electron-spawn-env";

const researchRoot = dirname(fileURLToPath(import.meta.url));
const projectRoot = join(researchRoot, "..", "..");
const outputRoot = await mkdtemp(join(tmpdir(), "openbot-research-670-build-"));
try {
  const outputPath = join(outputRoot, "capture.mjs");
  const buildCode = await run(process.execPath, [
    "build",
    join(researchRoot, "capture-electron.ts"),
    "--target=node",
    "--format=esm",
    "--external=electron",
    `--outfile=${outputPath}`,
  ]);
  if (buildCode !== 0) throw new Error("Unable to build the capture script.");
  const electron = join(projectRoot, "node_modules", ".bin", "electron");
  process.exitCode = await run(electron, [outputPath, `--root=${researchRoot}`]);
} finally {
  await rm(outputRoot, { recursive: true, force: true });
}

function run(command: string, args: string[]): Promise<number> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd: projectRoot,
      env: withoutElectronRuntimeFlags(process.env),
      stdio: "inherit",
    });
    child.once("error", reject);
    child.once("exit", (code) => resolve(code ?? 1));
  });
}
