// #3066: an AppImage runs from a FUSE mount of its own, and Crashpad starts `chrome_crashpad_handler`
// from that mount. The handler outlives the main process, so when the AppImage runtime unmounts after
// the main process exits, the handler faults on a code page it cannot read and dies with SIGBUS. The
// desktop then shows a crash report on every quit. Electron cannot start the handler from elsewhere.
import { readdirSync, readlinkSync, statSync } from "node:fs";
import { dirname, join } from "node:path";

// `--appimage-extract-and-run` shares one extracted folder among launches and never unmounts it.
function runsFromOwnMount(directory: string): boolean {
  try {
    return statSync(directory).dev !== statSync(dirname(directory)).dev;
  } catch {
    return false;
  }
}

/**
 * Stops the Crashpad handler of this launch when Node exits, before the runtime unmounts the AppImage.
 * `exit` comes after `will-quit` and also after the `app.exit` of the shutdown deadline. SIGKILL, not
 * SIGTERM: the handler would run its own signal code from the mount that goes away.
 */
export function stopAppImageCrashpadHandlerAtExit(): void {
  if (process.platform !== "linux" || !process.env.APPIMAGE?.trim()) return;
  const directory = dirname(process.execPath);
  if (!runsFromOwnMount(directory)) return;
  // Each launch has a mount path of its own, so this matches no handler of another launch.
  const handlerPath = join(directory, "chrome_crashpad_handler");
  process.once("exit", () => {
    let entries: string[];
    try {
      entries = readdirSync("/proc");
    } catch {
      // A throw here would be an uncaught exception during exit.
      return;
    }
    for (const entry of entries) {
      if (!/^\d+$/u.test(entry)) continue;
      try {
        if (readlinkSync(`/proc/${entry}/exe`) === handlerPath) process.kill(Number(entry), "SIGKILL");
      } catch {
        // The process ended, or it belongs to another user.
      }
    }
  });
}
