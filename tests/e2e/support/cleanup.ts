// Recovery after a worker or CI job fails. Use the existing PID identity checks.
import { execFile } from "node:child_process";
import { existsSync } from "node:fs";
import { readdir, rm } from "node:fs/promises";
import { join } from "node:path";
import { promisify } from "node:util";
import { createOpenBotLogger } from "@openbot/logging";
import { output, root } from "./settings";

const logger = createOpenBotLogger("e2e-cleanup");
if (existsSync(output)) {
  for (const entry of await readdir(output, { withFileTypes: true })) {
    if (!entry.isDirectory() || !entry.name.startsWith("private-")) continue;
    const directory = join(output, entry.name);
    const registry = join(directory, "registry");
    if (!existsSync(registry)) continue;
    try {
      await promisify(execFile)("bun", ["scripts/dev-stack.ts", "stop", "--all"], {
        cwd: root,
        env: { ...process.env, OPENBOT_DEV_REGISTRY_DIR: registry },
        timeout: 60_000,
      });
      await rm(directory, { recursive: true, force: true });
    } catch (error) {
      logger.error("Test cleanup failed. Keep the registry and profiles until all recorded processes stop.", error);
      process.exitCode = 1;
    }
  }
}
