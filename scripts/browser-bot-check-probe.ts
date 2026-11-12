import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { withoutElectronRuntimeFlags } from "./electron-spawn-env";

// Measures how live sites' bot checks treat the agent browser. It is not a CI check: it loads the
// sites of a list that the caller supplies (`--sites=<json>`: `[{ id, website, category }]`) once
// each, and writes `.openbot-build/browser-bot-check-probe/<name>/report.json` with page images.
//   bun scripts/browser-bot-check-probe.ts --sites=<file> [--name=desktop] [--server-gpu]

const option = (name: string) => process.argv.find((item) => item.startsWith(`--${name}=`))?.slice(name.length + 3);
const sites = option("sites");
if (!sites) throw new Error("Missing --sites=<json file>.");
const name = option("name") ?? "run";

const projectRoot = dirname(dirname(fileURLToPath(import.meta.url)));
const buildRoot = await mkdtemp(join(tmpdir(), "openbot-bot-check-"));
const reportRoot = join(projectRoot, ".openbot-build/browser-bot-check-probe", name);
const reportPath = join(reportRoot, "report.json");
try {
  await rm(reportRoot, { recursive: true, force: true });
  await mkdir(reportRoot, { recursive: true });
  const entry = join(reportRoot, "browser-bot-check-probe.mjs");
  const pagePreload = join(reportRoot, "browserPage.cjs");
  await run(process.execPath, [
    "build",
    join(projectRoot, "src/preload/browser-page.ts"),
    "--target=node",
    "--format=cjs",
    "--external=electron",
    `--outfile=${pagePreload}`,
  ]);
  await run(process.execPath, [
    "build",
    join(projectRoot, "scripts/browser-bot-check-probe-electron.ts"),
    "--target=node",
    "--format=esm",
    "--external=electron",
    "--external=quickjs-emscripten-core",
    "--external=@jitl/quickjs-wasmfile-release-sync",
    `--outfile=${entry}`,
  ]);
  await run(
    join(projectRoot, "node_modules/.bin/electron"),
    [
      ...(process.platform === "linux" ? ["--no-sandbox"] : []),
      entry,
      `--fixture-root=${buildRoot}`,
      `--page-preload=${pagePreload}`,
      `--report-path=${reportPath}`,
      `--sites=${resolve(sites)}`,
      `--source-sha=${option("source-sha") ?? "unknown"}`,
      `--run-id=${randomUUID()}`,
      ...(process.argv.includes("--server-gpu") ? ["--server-gpu"] : []),
    ],
    true,
  );
  process.stdout.write(`${JSON.stringify({ report: reportPath })}\n`);
} finally {
  await rm(buildRoot, { recursive: true, force: true });
}

async function run(command: string, args: string[], electron = false): Promise<void> {
  await new Promise<void>((done, reject) => {
    const child = spawn(command, args, {
      cwd: projectRoot,
      stdio: "inherit",
      env: electron ? withoutElectronRuntimeFlags(process.env) : process.env,
    });
    child.once("error", reject);
    child.once("exit", (code, signal) =>
      code === 0 && signal === null ? done() : reject(new Error(`Process failed (${code ?? signal}).`)),
    );
  });
}
