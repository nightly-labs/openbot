import { appendTextLog } from "./diagnostics-log";

export async function appendRemoteDiagnosticLog(
  directory: string,
  name: string,
  message: string | Uint8Array,
): Promise<void> {
  const safeName = name.replace(/[^a-zA-Z0-9_-]/gu, "-").slice(0, 80);
  // Keep the token format used by the remote processes. The shared redactor
  // then removes the other secret formats before truncation or disk writes.
  await appendTextLog({
    directory,
    fileName: `${safeName}.log`,
    text: Buffer.from(message)
      .toString("utf8")
      .replace(/token[=: ]+[A-Za-z0-9._-]{8,}/giu, "[redacted]"),
  });
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
