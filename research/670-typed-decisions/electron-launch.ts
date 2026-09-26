// Builds an Electron entry script and runs it under the repository's Electron, as scripts/browser-smoke.ts does.
import { spawn } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { withoutElectronRuntimeFlags } from "../../scripts/electron-spawn-env";

export const researchRoot = dirname(fileURLToPath(import.meta.url));
const projectRoot = join(researchRoot, "..", "..");

export async function launchElectron(entry: string, args: string[]): Promise<number> {
  const outputRoot = await mkdtemp(join(tmpdir(), "openbot-research-670-build-"));
  try {
    const outputPath = join(outputRoot, "entry.mjs");
    const buildCode = await run(process.execPath, [
      "build",
      join(researchRoot, entry),
      "--target=node",
      "--format=esm",
      "--external=electron",
      `--outfile=${outputPath}`,
    ]);
    if (buildCode !== 0) throw new Error(`Unable to build ${entry}.`);
    const electron = join(projectRoot, "node_modules", ".bin", "electron");
    return await run(electron, [outputPath, `--root=${researchRoot}`, ...args]);
  } finally {
    await rm(outputRoot, { recursive: true, force: true });
  }
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
