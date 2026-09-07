import { appendTextLog } from "./diagnostics-log";

export async function appendRemoteDiagnosticLog(
  directory: string,
  name: string,
  message: string | Uint8Array,
): Promise<void> {
  const safeName = name.replace(/[^a-zA-Z0-9_-]/gu, "-").slice(0, 80);
  // The text is a remote process's own stdout, so it goes through the one
  // redaction the app has rather than the weaker copy that used to live here.
  await appendTextLog({ directory, fileName: `${safeName}.log`, text: Buffer.from(message).toString("utf8") });
}

interface ManagedChildProcess {
  exitCode: number | null;
  killed: boolean;
  kill(signal?: NodeJS.Signals): boolean;
  once(event: string, listener: (...args: unknown[]) => unknown): unknown;
}

export async function stopRemoteProcess(child: ManagedChildProcess, graceMs = 2_000): Promise<void> {
  if (child.exitCode !== null || child.killed) return;
  await new Promise<void>((resolve) => {
    let complete = false;
    const finish = () => {
      if (complete) return;
      complete = true;
      clearTimeout(forceTimer);
      resolve();
    };
    const forceTimer = setTimeout(() => {
      if (child.exitCode === null) child.kill("SIGKILL");
      finish();
    }, graceMs);
    child.once("exit", finish);
    child.kill("SIGTERM");
  });
}
