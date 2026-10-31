// #3066: an AppImage runs from a FUSE mount of its own, and Chromium starts its helpers from that
// mount: `chrome_crashpad_handler`, the zygotes, and the renderers that they fork. A helper can
// outlive the main process, so when the AppImage runtime unmounts after the main process exits, the
// helper faults on a code page it cannot read and dies with SIGBUS. The desktop then shows a crash
// report. A zygote that is still shutting down when `quitAndInstall` relaunches the app does this too.
import { readdirSync, readlinkSync, statSync } from "node:fs";
import { dirname } from "node:path";

// `--appimage-extract-and-run` shares one extracted folder among launches and never unmounts it.
function runsFromOwnMount(directory: string): boolean {
  try {
    return statSync(directory).dev !== statSync(dirname(directory)).dev;
  } catch {
    return false;
  }
}

/**
 * Stops each helper of this launch when Node exits, before the runtime unmounts the AppImage. A
 * process that still runs from the mount at that point cannot survive the unmount. `exit` comes after
 * `will-quit` and also after the `app.exit` of the shutdown deadline. SIGKILL, not SIGTERM: the helper
 * would run its own signal code from the mount that goes away.
 */
export function stopAppImageHelpersAtExit(): void {
  if (process.platform !== "linux" || !process.env.APPIMAGE?.trim()) return;
  const directory = dirname(process.execPath);
  if (!runsFromOwnMount(directory)) return;
  // Each launch has a mount path of its own, so this matches no helper of another launch, and not the
  // AppImage that `quitAndInstall` starts: that one runs from a new mount.
  const mountPrefix = `${directory}/`;
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
      const pid = Number(entry);
      if (pid === process.pid) continue;
      try {
        if (readlinkSync(`/proc/${entry}/exe`).startsWith(mountPrefix)) process.kill(pid, "SIGKILL");
      } catch {
        // The process ended, or it belongs to another user.
      }
    }
  });
}
