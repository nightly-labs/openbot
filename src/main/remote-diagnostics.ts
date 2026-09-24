import { appendFile, mkdir, rename, stat } from "node:fs/promises";
import { join } from "node:path";
import type { Readable } from "node:stream";
import { redactText } from "@openbot/logging";

const MAX_LOG_BYTES = 1024 * 1024;
const MAX_LINE_CHARACTERS = 8_000;
const MAX_WRITE_CHARACTERS = 8_000;

/** The appends for each file run one at a time, so a rotation never races a write. */
const queues = new Map<string, Promise<void>>();

export function appendRemoteDiagnosticLog(
  directory: string,
  name: string,
  message: string | Uint8Array,
): Promise<void> {
  const safeName = name.replace(/[^a-zA-Z0-9_-]/gu, "-").slice(0, 80);
  const path = join(directory, `${safeName}.log`);
  const clean = Buffer.from(message)
    .toString("utf8")
    .split("\n")
    .map(redactText)
    .join("\n")
    .slice(0, MAX_WRITE_CHARACTERS);
  const queue = (queues.get(path) ?? Promise.resolve())
    .then(() => (clean ? writeDiagnostic(directory, path, clean) : undefined))
    .catch(() => undefined);
  queues.set(path, queue);
  return queue;
}

/**
 * Hands a process stream's output on in whole lines, so a secret that arrives split across two
 * chunks is redacted as one value. Each stream keeps its own carry-over: stdout and stderr
 * interleave, and one shared between them would join a line neither printed. The last line is
 * handed on when the stream ends, newline or not. A line longer than the limit is cut there and the
 * rest of it dropped, because a piece written on its own could hold a secret no rule matches.
 */
export function forwardDiagnosticLines(stream: Readable | null | undefined, forward: (text: string) => void): void {
  let partial = "";
  let dropping = false;
  stream?.on("data", (chunk: Buffer | string) => {
    const lines = (partial + chunk.toString()).split("\n");
    partial = lines.pop() ?? "";
    const complete: string[] = [];
    for (const line of lines) {
      if (!dropping) complete.push(line.slice(0, MAX_LINE_CHARACTERS));
      dropping = false;
    }
    if (dropping) partial = "";
    else if (partial.length > MAX_LINE_CHARACTERS) {
      complete.push(partial.slice(0, MAX_LINE_CHARACTERS));
      partial = "";
      dropping = true;
    }
    if (complete.length) forward(`${complete.join("\n")}\n`);
  });
  stream?.on("end", () => {
    if (partial && !dropping) forward(`${partial}\n`);
    partial = "";
  });
}

async function writeDiagnostic(directory: string, path: string, clean: string): Promise<void> {
  await mkdir(directory, { recursive: true });
  try {
    if ((await stat(path)).size >= MAX_LOG_BYTES) await rename(path, `${path}.1`);
  } catch {
    // A missing diagnostic file does not need rotation.
  }
  await appendFile(path, clean, { encoding: "utf8", mode: 0o600 });
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
