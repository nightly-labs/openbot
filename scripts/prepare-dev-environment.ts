import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { constants, copyFileSync, existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, isAbsolute, join, normalize, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { developmentInstanceIdForWorktree } from "../src/main/development-profile";
import { type DevelopmentEnvOutcome, ensureDevelopmentEnvFile } from "./development-secrets";

const scriptsRoot = dirname(fileURLToPath(import.meta.url));
export const developmentProjectRoot = dirname(scriptsRoot);

export type DevelopmentCommandRunner = (
  executable: string,
  args: string[],
  options: { cwd: string; stdio: "inherit"; env?: NodeJS.ProcessEnv },
) => void;

export const supportedBunVersion = "1.4.0";

// A stamp holds the fingerprint of the inputs of the last command that succeeded. `bun run dev`
// skips the command while the fingerprint is the same, which saves several seconds on each start.
// The install stamp is in `node_modules`, so deleting `node_modules` installs again.
const INSTALL_STAMP = join("node_modules", ".openbot-install-stamp");
const MIGRATION_STAMP = join("apps", "auth-api", ".wrangler", ".openbot-migrate-local-stamp");
// Wrangler's local D1 state. Without it the local database is empty, whatever the stamp says.
const LOCAL_D1_STATE = join("apps", "auth-api", ".wrangler", "state", "v3", "d1");
const MIGRATIONS_DIRECTORY = join("apps", "auth-api", "migrations");

export interface DevelopmentPreparationInput {
  projectRoot?: string;
  /** The main checkout that owns this worktree; read from git when omitted. */
  mainCheckoutRoot?: string;
  executable?: string;
  bunVersion?: string;
  run?: DevelopmentCommandRunner;
}

export function prepareDevelopmentEnvironment(input: DevelopmentPreparationInput = {}): DevelopmentEnvOutcome {
  const projectRoot = input.projectRoot ?? developmentProjectRoot;
  assertSupportedBunVersion(input.bunVersion ?? process.versions.bun ?? "unknown");
  // Before the env file, so a worktree reuses the main checkout's `.env.dev` identity.
  const copied = copyWorktreeIncludes(projectRoot, input.mainCheckoutRoot ?? findMainCheckoutRoot(projectRoot));
  for (const path of copied) process.stdout.write(`Copied ${path} from the main checkout.\n`);
  // Before `bun install`, because a fresh clone has no `.env.dev` and both dev services load one.
  // Only `.env.production` is still encrypted, so a fork needs no `.env.keys` to reach this point.
  const envFile = ensureDevelopmentEnvFile(projectRoot);

  const executable = input.executable ?? process.execPath;
  const run = input.run ?? execDevelopmentCommand;
  const options = { cwd: projectRoot, stdio: "inherit" as const };

  runUnlessStamped(
    join(projectRoot, INSTALL_STAMP),
    () => installFingerprint(projectRoot),
    () => run(executable, ["install", "--frozen-lockfile"], options),
  );
  runUnlessStamped(
    join(projectRoot, MIGRATION_STAMP),
    () => (existsSync(join(projectRoot, LOCAL_D1_STATE)) ? migrationFingerprint(projectRoot) : null),
    () => run(executable, ["run", "api:migrate:local"], options),
  );
  return envFile;
}

/**
 * Runs `command` unless the stamp holds the current fingerprint, then stamps the fingerprint that
 * holds after it. `null` means the inputs are not there yet: the command runs and nothing is stamped.
 */
function runUnlessStamped(stampPath: string, fingerprint: () => string | null, command: () => void): void {
  const before = fingerprint();
  if (before !== null && readStamp(stampPath) === before) return;
  command();
  const after = fingerprint();
  if (after === null) return;
  mkdirSync(dirname(stampPath), { recursive: true });
  writeFileSync(stampPath, `${after}\n`);
}

function readStamp(path: string): string | null {
  try {
    return readFileSync(path, "utf8").trim();
  } catch {
    return null;
  }
}

/**
 * The inputs of `bun install --frozen-lockfile`: the lockfile, every workspace manifest, the Bun
 * configuration and patches, the Bun version, and `OPENBOT_SKIP_SKIA`, which changes `postinstall`.
 */
export function installFingerprint(projectRoot: string, environment: NodeJS.ProcessEnv = process.env): string {
  const files = ["bun.lock", "bunfig.toml", "package.json", ...workspaceManifests(projectRoot)];
  const patches = join(projectRoot, "patches");
  if (existsSync(patches)) {
    for (const entry of readdirSync(patches, { withFileTypes: true })) {
      if (entry.isFile()) files.push(join("patches", entry.name));
    }
  }
  return fingerprintFiles(projectRoot, files, [
    `bun ${process.versions.bun ?? "unknown"}`,
    `OPENBOT_SKIP_SKIA=${environment.OPENBOT_SKIP_SKIA ?? ""}`,
  ]);
}

/** The names and contents of the Account API migrations that `api:migrate:local` applies. */
export function migrationFingerprint(projectRoot: string): string {
  const directory = join(projectRoot, MIGRATIONS_DIRECTORY);
  const names = existsSync(directory) ? readdirSync(directory) : [];
  return fingerprintFiles(
    projectRoot,
    names.map((name) => join(MIGRATIONS_DIRECTORY, name)),
    [],
  );
}

// `apps/*`-style workspace patterns from the root `package.json`, which is all the repository uses.
function workspaceManifests(projectRoot: string): string[] {
  let patterns: unknown;
  try {
    patterns = JSON.parse(readFileSync(join(projectRoot, "package.json"), "utf8")).workspaces?.packages;
  } catch {
    return [];
  }
  if (!Array.isArray(patterns)) return [];
  const manifests: string[] = [];
  for (const pattern of patterns) {
    if (typeof pattern !== "string") continue;
    if (!pattern.endsWith("/*")) {
      manifests.push(join(pattern, "package.json"));
      continue;
    }
    const parent = pattern.slice(0, -2);
    if (!existsSync(join(projectRoot, parent))) continue;
    for (const entry of readdirSync(join(projectRoot, parent), { withFileTypes: true })) {
      if (entry.isDirectory()) manifests.push(join(parent, entry.name, "package.json"));
    }
  }
  return manifests;
}

function fingerprintFiles(projectRoot: string, files: string[], extra: string[]): string {
  const hash = createHash("sha256");
  for (const line of extra) hash.update(`${line}\n`);
  for (const file of [...files].sort()) {
    const path = join(projectRoot, file);
    hash.update(`${file}\n`);
    hash.update(existsSync(path) ? readFileSync(path) : "missing");
    hash.update("\n");
  }
  return hash.digest("hex");
}

export function prepareDevelopmentWorktree(input: DevelopmentPreparationInput = {}): DevelopmentEnvOutcome {
  const projectRoot = input.projectRoot ?? developmentProjectRoot;
  const envFile = prepareDevelopmentEnvironment({ ...input, projectRoot });
  const executable = input.executable ?? process.execPath;
  const run = input.run ?? execDevelopmentCommand;
  const options = { cwd: projectRoot, stdio: "inherit" as const };
  const instanceId = developmentInstanceIdForWorktree(projectRoot);

  run(executable, ["run", "dev:seed", "--if-missing"], {
    ...options,
    env: { ...process.env, OPENBOT_DEV_INSTANCE_ID: instanceId },
  });
  run(executable, ["run", "marketplace:seed:local"], options);
  return envFile;
}

/**
 * Copies each ignored file that `.worktreeinclude` lists from the main checkout, so a worktree made
 * by any harness gets the local secrets without a manual copy. An existing file is never replaced.
 * Lines are literal paths, not gitignore patterns. A path that leaves the checkout is skipped.
 */
export function copyWorktreeIncludes(projectRoot: string, mainCheckoutRoot: string | undefined): string[] {
  if (!mainCheckoutRoot || resolve(mainCheckoutRoot) === resolve(projectRoot)) return [];
  const listPath = join(projectRoot, ".worktreeinclude");
  if (!existsSync(listPath)) return [];

  const copied: string[] = [];
  for (const line of readFileSync(listPath, "utf8").split("\n")) {
    const path = line.trim();
    if (!path || path.startsWith("#") || !isInsideCheckout(path)) continue;
    const source = join(mainCheckoutRoot, path);
    const target = join(projectRoot, path);
    if (!existsSync(source) || existsSync(target)) continue;
    mkdirSync(dirname(target), { recursive: true });
    copyFileSync(source, target, constants.COPYFILE_EXCL);
    copied.push(path);
  }
  return copied;
}

function isInsideCheckout(path: string): boolean {
  const normalized = normalize(path);
  return !isAbsolute(normalized) && normalized !== ".." && !normalized.startsWith(`..${sep}`);
}

function findMainCheckoutRoot(projectRoot: string): string | undefined {
  try {
    const commonDir = execFileSync("git", ["rev-parse", "--path-format=absolute", "--git-common-dir"], {
      cwd: projectRoot,
      encoding: "utf8",
    }).trim();
    return dirname(commonDir);
  } catch {
    // A source archive has no git metadata, so there is nothing to copy from.
    return undefined;
  }
}

export function assertSupportedBunVersion(version: string): void {
  if (version === supportedBunVersion) return;

  throw new Error(
    `Unsupported Bun ${version}. OpenBot development requires stable Bun ${supportedBunVersion}. Install the exact version with the command in https://github.com/nightly-labs/openbot#development, then retry.`,
  );
}

function execDevelopmentCommand(
  executable: string,
  args: string[],
  options: { cwd: string; stdio: "inherit"; env?: NodeJS.ProcessEnv },
): void {
  execFileSync(executable, args, options);
}

if (import.meta.main) {
  // Generating secrets without saying so leaves a contributor guessing where the file came from.
  // stdout rather than a logger, because this runs before `bun install` on a fresh clone.
  if (prepareDevelopmentWorktree() === "created") {
    process.stdout.write("Generated apps/auth-api/.env.dev for local development.\n");
  }
}
