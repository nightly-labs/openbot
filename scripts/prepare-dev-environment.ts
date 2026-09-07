import { execFileSync } from "node:child_process";
import { dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { ensureDevelopmentEnvFile } from "./development-secrets";

const scriptsRoot = dirname(fileURLToPath(import.meta.url));
export const developmentProjectRoot = dirname(scriptsRoot);

export type DevelopmentCommandRunner = (
  executable: string,
  args: string[],
  options: { cwd: string; stdio: "inherit" },
) => void;

export const supportedBunVersion = "1.4.0";

export function prepareDevelopmentEnvironment(
  input: { projectRoot?: string; executable?: string; bunVersion?: string; run?: DevelopmentCommandRunner } = {},
): void {
  const projectRoot = input.projectRoot ?? developmentProjectRoot;
  assertSupportedBunVersion(input.bunVersion ?? process.versions.bun ?? "unknown");
  // Before `bun install`, because a fresh clone has no `.env.dev` and both dev services load one.
  // Only `.env.production` is still encrypted, so a fork needs no `.env.keys` to reach this point.
  ensureDevelopmentEnvFile(projectRoot);

  const executable = input.executable ?? process.execPath;
  const run = input.run ?? execDevelopmentCommand;
  const options = { cwd: projectRoot, stdio: "inherit" as const };

  run(executable, ["install", "--frozen-lockfile"], options);
  run(executable, ["run", "api:migrate:local"], options);
}

export function assertSupportedBunVersion(version: string): void {
  if (version === supportedBunVersion) return;

  throw new Error(
    `Unsupported Bun ${version}. OpenBot development requires stable Bun ${supportedBunVersion}. Install the exact version with the command in https://github.com/NorbertBodziony/openbot#development, then retry.`,
  );
}

function execDevelopmentCommand(executable: string, args: string[], options: { cwd: string; stdio: "inherit" }): void {
  execFileSync(executable, args, options);
}

if (import.meta.main) {
  prepareDevelopmentEnvironment();
}
