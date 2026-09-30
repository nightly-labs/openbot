import { type ChildProcess, execFile } from "node:child_process";

/**
 * Stops a process and every process it started, and waits for it to exit. Windows has no process
 * group: a `.cmd` command runs under `cmd.exe`, and a kill of the wrapper leaves the real program
 * running. `taskkill /T` stops the whole tree while the wrapper still holds it.
 */
export async function stopWindowsProcessTree(child: ChildProcess): Promise<void> {
  if (child.pid === undefined || child.exitCode !== null || child.signalCode !== null) return;
  const exited = new Promise<void>((resolve) => child.once("exit", () => resolve()));
  await new Promise<void>((resolve) =>
    execFile("taskkill", ["/pid", String(child.pid), "/T", "/F"], { windowsHide: true }, () => resolve()),
  );
  if (child.exitCode === null && child.signalCode === null) child.kill("SIGKILL");
  await exited;
}

/**
 * Stops a process that may run under `cmd.exe`, such as a sign-in through a `.cmd` launcher, and
 * does not wait for it. Elsewhere SIGTERM goes to the process itself.
 */
export function stopProcessTree(child: ChildProcess): void {
  if (child.exitCode !== null || child.signalCode !== null) return;
  if (process.platform === "win32") void stopWindowsProcessTree(child);
  else child.kill("SIGTERM");
}
