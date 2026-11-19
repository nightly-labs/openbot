import { execFileSync, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  closeSync,
  existsSync,
  lstatSync,
  mkdirSync,
  openSync,
  readdirSync,
  readFileSync,
  readlinkSync,
  readSync,
  renameSync,
  rmSync,
  statSync,
  utimesSync,
  writeFileSync,
} from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

type Arch = "arm64" | "x64";

const PLATFORM_PATH = "Electron.app/Contents/MacOS/Electron";
const FILE_LIST = "files.sha256";
const UNUSED_ENTRY_AGE_MS = 30 * 24 * 60 * 60 * 1000;
const STAGING_PREFIX = ".staging-";
const UNUSED_STAGING_AGE_MS = 60 * 60 * 1000;
const INSTALL_OVERRIDES = [
  "ELECTRON_INSTALL_PLATFORM",
  "ELECTRON_INSTALL_ARCH",
  "ELECTRON_OVERRIDE_DIST_PATH",
  "npm_config_platform",
  "npm_config_arch",
  "force_no_cache",
];

const electronRoot = join(dirname(dirname(fileURLToPath(import.meta.url))), "node_modules", "electron");
const distPath = join(electronRoot, "dist");
const pathFile = join(electronRoot, "path.txt");
const cacheRoot = join(homedir(), "Library", "Caches", "OpenBot", "electron-dist");

function isInstalled(dist: string, version: string): boolean {
  try {
    return (
      readFileSync(join(dist, "version"), "utf8").replace(/^v/u, "") === version &&
      existsSync(join(dist, PLATFORM_PATH))
    );
  } catch {
    return false;
  }
}

function isInstalledHere(version: string): boolean {
  try {
    return readFileSync(pathFile, "utf8") === PLATFORM_PATH && isInstalled(distPath, version);
  } catch {
    return false;
  }
}

function computerArch(): Arch | null {
  if (process.arch === "arm64") return "arm64";
  if (process.arch !== "x64") return null;
  try {
    const translated = execFileSync("sysctl", ["-in", "sysctl.proc_translated"], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    });
    return translated.trim() === "1" ? "arm64" : "x64";
  } catch {
    return null;
  }
}

function executableArch(dist: string): Arch | null {
  try {
    const description = execFileSync("/usr/bin/file", ["-b", join(dist, PLATFORM_PATH)], { encoding: "utf8" });
    if (description.includes("arm64")) return "arm64";
    return description.includes("x86_64") ? "x64" : null;
  } catch {
    return null;
  }
}

function fileList(dir: string, relative = ""): string {
  const path = join(dir, relative);
  const stats = lstatSync(path);
  const mode = (stats.mode & 0o7777).toString(8);
  if (stats.isSymbolicLink()) return `l ${mode} ${relative} -> ${readlinkSync(path)}\n`;
  if (stats.isFile()) return `f ${mode} ${relative} ${fileSha256(path)}\n`;
  let lines = `d ${mode} ${relative}\n`;
  for (const name of readdirSync(path).sort()) lines += fileList(dir, relative === "" ? name : `${relative}/${name}`);
  return lines;
}

function fileSha256(path: string): string {
  const hash = createHash("sha256");
  const buffer = Buffer.allocUnsafe(1 << 20);
  const descriptor = openSync(path, "r");
  try {
    for (let length = readSync(descriptor, buffer); length > 0; length = readSync(descriptor, buffer)) {
      hash.update(buffer.subarray(0, length));
    }
  } finally {
    closeSync(descriptor);
  }
  return hash.digest("hex");
}

function cloneTree(source: string, target: string): void {
  const result = spawnSync("/bin/cp", ["-c", "-R", source, target], { stdio: ["ignore", "ignore", "pipe"] });
  if (result.status !== 0) throw new Error(result.stderr?.toString().trim() || `cp exited with ${result.status}`);
}

function readFileList(entry: string): string | null {
  try {
    return readFileSync(join(entry, FILE_LIST), "utf8");
  } catch {
    return null;
  }
}

function restore(entry: string, version: string): void {
  if (isInstalledHere(version) || !existsSync(entry)) return;
  try {
    const now = new Date();
    utimesSync(entry, now, now);
  } catch {}
  const staging = join(electronRoot, `.dist-${process.pid}`);
  let cloned = false;
  try {
    rmSync(staging, { recursive: true, force: true });
    const expected = readFileList(entry);
    if (expected !== null) {
      cloneTree(join(entry, "dist"), staging);
      cloned = isInstalled(staging, version) && fileList(staging) === expected;
    }
    if (!cloned) {
      rmSync(staging, { recursive: true, force: true });
      removeDamagedEntry(entry);
      return;
    }
    rmSync(distPath, { recursive: true, force: true });
    renameSync(staging, distPath);
    writeFileSync(pathFile, PLATFORM_PATH);
    process.stdout.write(`Cloned Electron ${version} from ${entry}.\n`);
  } catch (error) {
    rmSync(staging, { recursive: true, force: true });
    process.stdout.write(`Did not clone Electron from the cache (${String(error)}). install-electron installs it.\n`);
  }
}

function removeDamagedEntry(entry: string): void {
  try {
    rmSync(entry, { recursive: true, force: true });
    process.stdout.write(`Removed a damaged Electron cache entry: ${entry}.\n`);
  } catch {}
}

function save(entry: string, version: string, arch: Arch): void {
  if (existsSync(join(entry, FILE_LIST)) && isInstalled(join(entry, "dist"), version)) return;
  if (!isInstalledHere(version) || executableArch(distPath) !== arch) return;
  const staging = join(cacheRoot, `${STAGING_PREFIX}${process.pid}`);
  try {
    rmSync(entry, { recursive: true, force: true });
    rmSync(staging, { recursive: true, force: true });
    mkdirSync(staging, { recursive: true });
    cloneTree(distPath, join(staging, "dist"));
    writeFileSync(join(staging, FILE_LIST), fileList(join(staging, "dist")));
    renameSync(staging, entry);
    process.stdout.write(`Saved Electron ${version} to ${entry}.\n`);
    removeUnusedEntries(entry);
  } catch (error) {
    if (!existsSync(entry)) process.stdout.write(`Did not save Electron to the cache (${String(error)}).\n`);
  } finally {
    rmSync(staging, { recursive: true, force: true });
  }
}

function removeUnusedEntries(current: string): void {
  for (const name of readdirSync(cacheRoot)) {
    const entry = join(cacheRoot, name);
    const isStaging = name.startsWith(STAGING_PREFIX);
    if (entry === current || (name.startsWith(".") && !isStaging)) continue;
    try {
      const maxAge = isStaging ? UNUSED_STAGING_AGE_MS : UNUSED_ENTRY_AGE_MS;
      if (Date.now() - statSync(entry).mtimeMs > maxAge) rmSync(entry, { recursive: true, force: true });
    } catch {}
  }
}

const mode = process.argv[2];
if (mode !== "restore" && mode !== "save") throw new Error("Usage: bun scripts/electron-dist-cache.ts restore|save");
if (process.platform === "darwin" && !INSTALL_OVERRIDES.some((name) => process.env[name])) {
  const manifest: { version?: unknown } = JSON.parse(readFileSync(join(electronRoot, "package.json"), "utf8"));
  if (typeof manifest.version !== "string") throw new Error("node_modules/electron/package.json has no version.");
  const arch = computerArch();
  if (arch !== null) {
    const entry = join(cacheRoot, `${manifest.version}-darwin-${arch}`);
    if (mode === "restore") restore(entry, manifest.version);
    else save(entry, manifest.version, arch);
  }
}
