// #8256: an AppImage runs from a FUSE mount of its own, and that mount goes away with the process.
// `app.relaunch` starts the executable in that mount, so the new process loses its files a few
// seconds later. `execPath: APPIMAGE` does not help: Electron's relauncher sets `no_new_privs`, and
// the AppImage then cannot mount itself (`fusermount3` is setuid). A plain detached helper starts
// the AppImage file after this process is gone.
import { spawn } from "node:child_process";
import { dirname } from "node:path";
import { createOpenBotLogger, toLogValue } from "@openbot/logging";
import type { App } from "electron";
import { runsFromOwnMount } from "./linux-appimage-crashpad";

const logger = createOpenBotLogger("linux-appimage-relaunch");

// `$1` is the PID of this process. The helper stays its child until it dies; then the kernel gives
// the helper a new parent. A second instance that starts sooner would only hand over to the old one.
// Without `/proc` the read fails and the AppImage starts at once.
const START_AFTER_PARENT_EXIT =
  'while read -r _ _ _ parent _ </proc/self/stat && [ "$parent" = "$1" ]; do sleep 0.1; done; shift; exec "$@"';

/**
 * `environment` without the entries that AppRun added for this mount (`PATH`, `LD_LIBRARY_PATH`,
 * `XDG_DATA_DIRS`, `GSETTINGS_SCHEMA_DIR`). The new start adds its own, and a lookup through a mount
 * that is going away can fail.
 */
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

/**
 * Starts OpenBot again when this process exits, as `app.relaunch` does. The caller quits.
 *
 * Only a mounted AppImage takes the helper. All other builds, and an AppImage that runs with
 * `--appimage-extract-and-run`, keep `app.relaunch`: their executable stays where it is.
 */
export function relaunchApp(app: Pick<App, "relaunch">, args: string[]): void {
  const appImage = process.env.APPIMAGE?.trim();
  const mount = dirname(process.execPath);
  if (process.platform !== "linux" || !appImage || !runsFromOwnMount(mount)) {
    app.relaunch({ args });
    return;
  }
  try {
    const helper = spawn("/bin/sh", ["-c", START_AFTER_PARENT_EXIT, "sh", String(process.pid), appImage, ...args], {
      detached: true,
      stdio: "ignore",
      env: withoutMountEntries(process.env, mount),
    });
    helper.on("error", (error) => logger.warn("The AppImage could not start again.", toLogValue(error)));
    helper.unref();
  } catch (error) {
    logger.warn("The AppImage relaunch helper did not start.", toLogValue(error));
    app.relaunch({ args });
  }
}
