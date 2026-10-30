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

// The root `postinstall` runs `restore`, then `install-electron` (through
// `scripts/install-electron.ts`), then `save`. `install-electron`
// extracts ~320 MB of Electron into every worktree, and an extracted file is never an APFS clone.
// On macOS this keeps one extracted copy for each Electron version and architecture, and each
// worktree gets an APFS clone of it. `install-electron` stays the only step that downloads and
// checks the archive: `save` stores only a dist that it installed, with the SHA-256 of each file,
// and `restore` keeps a clone only when every cloned file matches the list. After `restore`,
// `install-electron` checks the clone as it checks its own install. Linux and Windows skip the cache.

type Arch = "arm64" | "x64";

const PLATFORM_PATH = "Electron.app/Contents/MacOS/Electron";
const FILE_LIST = "files.sha256";
const UNUSED_ENTRY_AGE_MS = 30 * 24 * 60 * 60 * 1000;
// A `save` that was stopped leaves its staging directory. A `save` in progress takes seconds.
const STAGING_PREFIX = ".staging-";
const UNUSED_STAGING_AGE_MS = 60 * 60 * 1000;
// These make `install-electron` install another platform, architecture or location than the key.
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

/** The same check as `isInstalled()` in `electron/install.js`. */
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

/**
 * The architecture that `install-electron` installs, or null when it is not known. It moves an x64
 * process under Rosetta to arm64, so an x64 process asks the same `sysctl` as `install-electron`.
 * A sandbox can refuse `sysctl`; then the cache is not used.
 */
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

/** One line for each entry in `dir`: its type, mode and path, and the SHA-256 or symlink target. */
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

/** `cp -c` clones with clonefile(2) and copies where a clone is not possible. `-R` keeps symlinks. */
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
  // The time keeps the entry from `removeUnusedEntries` while it is cloned. A sandbox can refuse
  // the change.
  try {
    const now = new Date();
    utimesSync(entry, now, now);
  } catch {}
  const staging = join(electronRoot, `.dist-${process.pid}`);
  let cloned = false;
  try {
    rmSync(staging, { recursive: true, force: true });
    // Another worktree can replace or remove the entry during the clone, so the check reads the clone.
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

/**
 * `save` makes the entry again after `install-electron` installs this version. A sandbox can refuse
 * the removal; then the entry stays unused, and the next `restore` checks it again.
 */
function removeDamagedEntry(entry: string): void {
  try {
    rmSync(entry, { recursive: true, force: true });
    process.stdout.write(`Removed a damaged Electron cache entry: ${entry}.\n`);
  } catch {}
}

function save(entry: string, version: string, arch: Arch): void {
  // `restore` checks each file of an existing entry before it uses the entry.
  if (existsSync(join(entry, FILE_LIST)) && isInstalled(join(entry, "dist"), version)) return;
  if (!isInstalledHere(version) || executableArch(distPath) !== arch) return;
  const staging = join(cacheRoot, `${STAGING_PREFIX}${process.pid}`);
  try {
    // An entry without a file list or a complete dist is damaged; a new one replaces it.
    rmSync(entry, { recursive: true, force: true });
    rmSync(staging, { recursive: true, force: true });
    mkdirSync(staging, { recursive: true });
    cloneTree(distPath, join(staging, "dist"));
    writeFileSync(join(staging, FILE_LIST), fileList(join(staging, "dist")));
    // Another worktree can save the same entry first. Then the rename fails and its entry stays.
    renameSync(staging, entry);
    process.stdout.write(`Saved Electron ${version} to ${entry}.\n`);
    removeUnusedEntries(entry);
  } catch (error) {
    if (!existsSync(entry)) process.stdout.write(`Did not save Electron to the cache (${String(error)}).\n`);
  } finally {
    rmSync(staging, { recursive: true, force: true });
  }
}

/** Another worktree can remove an entry at the same time, so a failed check skips that entry. */
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
