import { execFileSync } from "node:child_process";
import { constants, copyFileSync, existsSync, mkdirSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
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

  run(executable, ["install", "--frozen-lockfile"], options);
  run(executable, ["run", "api:migrate:local"], options);
  return envFile;
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
 * Lines are literal paths, not gitignore patterns.
 */
export function copyWorktreeIncludes(projectRoot: string, mainCheckoutRoot: string | undefined): string[] {
  if (!mainCheckoutRoot || resolve(mainCheckoutRoot) === resolve(projectRoot)) return [];
  const listPath = join(projectRoot, ".worktreeinclude");
  if (!existsSync(listPath)) return [];

  const copied: string[] = [];
  for (const line of readFileSync(listPath, "utf8").split("\n")) {
    const path = line.trim();
    if (!path || path.startsWith("#")) continue;
    const source = join(mainCheckoutRoot, path);
    const target = join(projectRoot, path);
    if (!existsSync(source) || existsSync(target)) continue;
    mkdirSync(dirname(target), { recursive: true });
    copyFileSync(source, target, constants.COPYFILE_EXCL);
    copied.push(path);
  }
  return copied;
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
