import { readdirSync, readlinkSync, statSync } from "node:fs";
import { dirname, join } from "node:path";

export function runsFromOwnMount(directory: string): boolean {
  try {
    return statSync(directory).dev !== statSync(dirname(directory)).dev;
  } catch {
    return false;
  }
}

export function stopAppImageCrashpadHandlerAtExit(): void {
  if (process.platform !== "linux" || !process.env.APPIMAGE?.trim()) return;
  const directory = dirname(process.execPath);
  if (!runsFromOwnMount(directory)) return;
  const handlerPath = join(directory, "chrome_crashpad_handler");
  process.once("exit", () => {
    let entries: string[];
    try {
      entries = readdirSync("/proc");
    } catch {
      return;
    }
    for (const entry of entries) {
      if (!/^\d+$/u.test(entry)) continue;
      try {
        if (readlinkSync(`/proc/${entry}/exe`) === handlerPath) process.kill(Number(entry), "SIGKILL");
      } catch {}
    }
  });
}
