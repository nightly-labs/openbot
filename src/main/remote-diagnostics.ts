import { appendFile, mkdir, rename, stat } from "node:fs/promises";
import { join } from "node:path";
import { redactText } from "@openbot/logging";
import { createDiagnosticStream } from "../backend/stderr-diagnostics";

export function createRemoteDiagnosticStream(emit: (message: string) => void) {
  return createDiagnosticStream({ redact: redactText, emit: (message) => emit(`${message}\n`) });
}

export async function appendRemoteDiagnosticLog(
  directory: string,
  name: string,
  message: string | Uint8Array,
): Promise<void> {
  await mkdir(directory, { recursive: true });
  const safeName = name.replace(/[^a-zA-Z0-9_-]/gu, "-").slice(0, 80);
  const path = join(directory, `${safeName}.log`);
  try {
    if ((await stat(path)).size >= 1024 * 1024) await rename(path, `${path}.1`);
  } catch {
    // A missing diagnostic file does not need rotation.
  }
  const clean = redactText(Buffer.from(message).toString("utf8")).slice(0, 8_000);
  if (clean) await appendFile(path, clean, { encoding: "utf8", mode: 0o600 });
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
