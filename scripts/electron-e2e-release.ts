import { spawnSync } from "node:child_process";
import { resolve } from "node:path";
import { createOpenBotLogger } from "@openbot/logging";
import { withoutElectronRuntimeFlags } from "./electron-spawn-env";

const logger = createOpenBotLogger("e2e-release");
const root = resolve(import.meta.dirname, "..");

export function runReleaseChecks(args: readonly string[]): number {
  if (args.length > 0) {
    logger.error("The release command requires the full suite. Use test:e2e or test:visual for test options.");
    return 1;
  }
  const env = withoutElectronRuntimeFlags(process.env);
  const steps = [
    { name: "Build app", args: ["run", "build"] },
    { name: "Install pinned Chromium", args: ["run", "playwright", "install", "chromium"] },
    {
      name: "Run required Electron cases",
      args: ["run", "test:e2e"],
    },
    { name: "Run visual comparisons", args: ["run", "test:visual"] },
  ];
  const started = Date.now();
  for (const step of steps) {
    logger.info(step.name);
    const result = spawnSync(process.execPath, step.args, {
      cwd: root,
      env: { ...env, OPENBOT_E2E_SUITE: "release" },
      stdio: "inherit",
    });
    if (result.error || result.signal || result.status !== 0) {
      logger.error("Release checks failed.", {
        step: step.name,
        exitCode: result.status,
        signal: result.signal,
        message: result.error?.message,
      });
      return result.status || 1;
    }
  }
  logger.info(
    `Release checks passed: fresh app build, Electron cases, and visual comparisons (${Math.round((Date.now() - started) / 1000)} seconds).`,
  );
  logger.info("Reports: .openbot-build/e2e/report/index.html and .openbot-build/visual/report/index.html");
  return 0;
}

if (import.meta.main) process.exitCode = runReleaseChecks(process.argv.slice(2));
