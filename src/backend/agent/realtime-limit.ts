import { readFileSync } from "node:fs";

/**
 * Whether this process has a hard `RLIMIT_RTTIME` of 0. Linux then stops each thread with a CPU-time
 * timer, such as the threads of the Gemini server, at its first tick. The provider processes get the
 * limit, and no process can increase it. PipeWire sets it in its client when xdg-desktop-portal has no
 * rtkit to read the real-time limit from (#4848). The limit can go to 0 while OpenBot runs, so each
 * call reads it again.
 */
export function hasZeroRealtimeLimit(): boolean {
  if (process.platform !== "linux") return false;
  try {
    return /^Max realtime timeout\s+\S+\s+0\s/mu.test(readFileSync("/proc/self/limits", "utf8"));
  } catch {
    // A system without the file has no limit to report, as on other platforms.
    return false;
  }
}
