import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { closeSync, existsSync, openSync, readFileSync } from "node:fs";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { setTimeout as sleep } from "node:timers/promises";
import { isDynamicRecord } from "@openbot/contracts/runtime-values";
import { withoutElectronRuntimeFlags } from "./electron-spawn-env";

const ROOT = resolve(import.meta.dirname, "..");
const OUT = join(ROOT, ".openbot-build", "linux-password-store-e2e");
const READY_TIMEOUT_MS = 30_000;
const electronPath = join(
  ROOT,
  "node_modules",
  "electron",
  "dist",
  readFileSync(join(ROOT, "node_modules", "electron", "path.txt"), "utf8").trim(),
);
const DESKTOP_VARIABLES = [
  "XDG_CURRENT_DESKTOP",
  "DESKTOP_SESSION",
  "KDE_SESSION_VERSION",
  "KDE_FULL_SESSION",
  "GNOME_DESKTOP_SESSION_ID",
];

if (process.platform !== "linux") {
  process.stdout.write("SKIP: Linux only\n");
  process.exit(0);
}

interface Case {
  name: string;
  environment: Record<string, string>;
  arguments?: string[];
  backend: string;
}

const CASES: Case[] = [
  { name: "Hyprland", environment: { XDG_CURRENT_DESKTOP: "Hyprland" }, backend: "gnome_libsecret" },
  { name: "sway", environment: { XDG_CURRENT_DESKTOP: "sway" }, backend: "gnome_libsecret" },
  { name: "LXQt", environment: { XDG_CURRENT_DESKTOP: "LXQt" }, backend: "gnome_libsecret" },
  { name: "no desktop hint", environment: {}, backend: "gnome_libsecret" },
  { name: "GNOME", environment: { XDG_CURRENT_DESKTOP: "ubuntu:GNOME" }, backend: "gnome_libsecret" },
  { name: "XFCE", environment: { XDG_CURRENT_DESKTOP: "XFCE" }, backend: "gnome_libsecret" },
  { name: "KDE 6", environment: { XDG_CURRENT_DESKTOP: "KDE", KDE_SESSION_VERSION: "6" }, backend: "kwallet6" },
  { name: "KDE through DESKTOP_SESSION", environment: { DESKTOP_SESSION: "kde-plasma" }, backend: "kwallet" },
  {
    name: "a user --password-store",
    environment: { XDG_CURRENT_DESKTOP: "Hyprland" },
    arguments: ["--password-store=basic"],
    backend: "basic_text",
  },
];

interface Result {
  name: string;
  configured: boolean;
  backend: string;
  available: boolean;
}

await mkdir(OUT, { recursive: true });
const root = await mkdtemp(join(tmpdir(), "openbot-linux-password-store-"));
const bundle = join(root, "linux-password-store-electron.mjs");
const results: Result[] = [];
let passed = false;
let error: string | undefined;

try {
  const build = spawnSync(process.execPath, [
    "build",
    join(ROOT, "scripts", "linux-password-store-electron.ts"),
    "--target=node",
    "--format=esm",
    "--external=electron",
    `--outfile=${bundle}`,
  ]);
  assert.equal(build.status, 0, `bun build failed: ${build.stderr.toString()}`);
  for (const [index, item] of CASES.entries()) {
    const result = await launch(index, item);
    results.push(result);
    assert.equal(result.backend, item.backend, `${item.name}: the backend`);
    assert.equal(result.available, false, `${item.name}: no Secret Service, so no encryption`);
  }
  passed = true;
} catch (caught) {
  error = caught instanceof Error ? caught.message : String(caught);
} finally {
  await writeFile(join(OUT, "report.json"), `${JSON.stringify({ passed, error, results }, null, 2)}\n`);
  await rm(root, { recursive: true, force: true });
}
process.stdout.write(passed ? `PASS: report in ${join(OUT, "report.json")}\n` : `FAIL: ${error}\n`);
process.exit(passed ? 0 : 1);

async function launch(index: number, item: Case): Promise<Result> {
  const base = withoutElectronRuntimeFlags(process.env);
  for (const name of DESKTOP_VARIABLES) delete base[name];
  base.DBUS_SESSION_BUS_ADDRESS = "unix:path=/nonexistent/openbot-e2e-bus";
  const readyFile = join(root, `ready-${index}.json`);
  const log = openSync(join(OUT, `electron-${index}.log`), "w");
  const child = spawn(
    electronPath,
    [bundle, `--user-data=${join(root, `user-data-${index}`)}`, `--ready-file=${readyFile}`, ...(item.arguments ?? [])],
    { env: { ...base, ...item.environment }, stdio: ["ignore", log, log] },
  );
  closeSync(log);
  const exited = new Promise<void>((done) => child.once("exit", () => done()));
  const deadline = Date.now() + READY_TIMEOUT_MS;
  while (!existsSync(readyFile)) {
    if (child.exitCode !== null || child.signalCode !== null) throw new Error(`${item.name}: Electron stopped early`);
    if (Date.now() > deadline) {
      child.kill("SIGKILL");
      throw new Error(`${item.name}: Electron was not ready`);
    }
    await sleep(50);
  }
  await exited;
  const ready = JSON.parse(readFileSync(readyFile, "utf8"));
  if (
    !isDynamicRecord(ready) ||
    typeof ready.configured !== "boolean" ||
    typeof ready.backend !== "string" ||
    typeof ready.available !== "boolean"
  )
    throw new Error(`${item.name}: the ready file is not valid`);
  return { name: item.name, configured: ready.configured, backend: ready.backend, available: ready.available };
}
