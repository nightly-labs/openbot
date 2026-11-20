import { readFileSync } from "node:fs";

export function hasZeroRealtimeLimit(): boolean {
  if (process.platform !== "linux") return false;
  try {
    return /^Max realtime timeout\s+\S+\s+0\s/mu.test(readFileSync("/proc/self/limits", "utf8"));
  } catch {
    return false;
  }
}
