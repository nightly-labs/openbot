import { spawn } from "node:child_process";
import { dirname } from "node:path";
import { createOpenBotLogger, toLogValue } from "@openbot/logging";
import type { App } from "electron";
import { runsFromOwnMount } from "./linux-appimage-crashpad";

const logger = createOpenBotLogger("linux-appimage-relaunch");

const START_AFTER_PARENT_EXIT = [
  'for fd in $(cd /proc/self/fd && echo *); do case $fd in *[!0-9]*|[012]) ;; *) eval "exec $fd>&-" ;; esac; done',
  'while read -r _ _ _ parent _ </proc/self/stat && [ "$parent" = "$1" ]; do sleep 0.1; done',
  'shift; exec "$@"',
].join("\n");

function withoutMountEntries(environment: NodeJS.ProcessEnv, mount: string): NodeJS.ProcessEnv {
  const inMount = (entry: string) => entry === mount || entry.startsWith(`${mount}/`);
  const cleaned: NodeJS.ProcessEnv = { ...environment };
  for (const [name, value] of Object.entries(environment)) {
    const entries = value?.split(":") ?? [];
    if (!entries.some(inMount)) continue;
    const kept = entries.filter((entry) => !inMount(entry)).join(":");
    if (kept) cleaned[name] = kept;
    else delete cleaned[name];
  }
  return cleaned;
}

export function relaunchApp(app: Pick<App, "relaunch">, args: string[]): void {
  const appImage = process.env.APPIMAGE?.trim();
  const mount = dirname(process.execPath);
  if (process.platform !== "linux" || !appImage || !runsFromOwnMount(mount)) {
    app.relaunch({ args });
    return;
  }
  try {
    const helper = spawn(
      "bash",
      ["-p", "-c", START_AFTER_PARENT_EXIT, "bash", String(process.pid), appImage, ...args],
      { detached: true, stdio: "ignore", env: withoutMountEntries(process.env, mount) },
    );
    helper.on("error", (error) => {
      logger.warn("The AppImage relaunch helper did not start.", toLogValue(error));
      app.relaunch({ args });
    });
    helper.unref();
  } catch (error) {
    logger.warn("The AppImage relaunch helper did not start.", toLogValue(error));
    app.relaunch({ args });
  }
}
