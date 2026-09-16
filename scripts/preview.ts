import { spawn } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { createOpenBotLogger } from "@openbot/logging";
import { withoutElectronRuntimeFlags } from "./electron-spawn-env";

const logger = createOpenBotLogger("preview");

const projectRoot = dirname(dirname(fileURLToPath(import.meta.url)));
const executable = join(
  projectRoot,
  "node_modules",
  ".bin",
  process.platform === "win32" ? "electron-vite.cmd" : "electron-vite",
);
const child = spawn(executable, ["preview", ...process.argv.slice(2)], {
  cwd: projectRoot,
  // The parent shell may run inside an Electron harness with
  // ELECTRON_RUN_AS_NODE=1, which would make the spawned Electron run as
  // plain Node instead of opening the preview app.
  env: { ...withoutElectronRuntimeFlags(process.env), OPENBOT_APP_VARIANT: "preview" },
  stdio: "inherit",
  shell: false,
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
