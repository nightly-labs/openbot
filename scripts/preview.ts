import { spawn } from "node:child_process";
import { dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { createOpenBotLogger } from "@openbot/logging";
import { cliSpawnTarget } from "../src/backend/cli";
import { withoutElectronRuntimeFlags } from "./electron-spawn-env";
import { resolvePackageBin } from "./package-bin";

const logger = createOpenBotLogger("preview");

const projectRoot = dirname(dirname(fileURLToPath(import.meta.url)));
const executable = resolvePackageBin(projectRoot, "electron-vite");
const target = cliSpawnTarget(executable, ["preview", ...process.argv.slice(2)]);
const child = spawn(target.command, target.args, {
  cwd: projectRoot,
  env: { ...withoutElectronRuntimeFlags(process.env), OPENBOT_APP_VARIANT: "preview" },
  stdio: "inherit",
  shell: false,
  windowsVerbatimArguments: target.windowsVerbatimArguments,
});

child.once("error", (error) => {
  logger.error("Could not start electron-vite preview:", error.message);
  process.exitCode = 1;
});
child.once("exit", (code, signal) => {
  if (signal) {
    process.exitCode = 1;
    return;
  }
  process.exitCode = code ?? 0;
});
