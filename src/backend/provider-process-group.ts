import type { ChildProcess } from "node:child_process";

export const PROVIDER_PROCESS_GROUP = process.platform !== "win32";

const GROUP_KILL_GRACE_MS = 2_000;

function signalProcessGroup(leader: number, signal: NodeJS.Signals): boolean {
  try {
    process.kill(-leader, signal);
    return true;
  } catch {
    return false;
  }
}

export function endProcessGroupOnExit(child: ChildProcess): void {
  const leader = child.pid;
  if (!PROVIDER_PROCESS_GROUP || leader === undefined) return;
  child.once("exit", () => {
    if (!signalProcessGroup(leader, "SIGTERM")) return;
    setTimeout(() => signalProcessGroup(leader, "SIGKILL"), GROUP_KILL_GRACE_MS).unref();
  });
}
