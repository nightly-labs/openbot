import { spawn } from "node:child_process";
import { appendFileSync, writeFileSync } from "node:fs";
import { homedir, hostname, userInfo } from "node:os";
import { isSecretName } from "@openbot/logging";
import { assertRedacted, createTranscriptRedactor, type TranscriptJson } from "./transcript-redaction";

export interface TranscriptLine {
  from: "client" | "agent";
  message: TranscriptJson;
}

const [executable, ...args] = process.argv.slice(2);
const out = process.env.TRANSCRIPT_OUT;
if (!executable || !out) throw new Error("Usage: TRANSCRIPT_OUT=<file> bun transcript-proxy.ts <executable> [args...]");

const extra: TranscriptJson = JSON.parse(process.env.TRANSCRIPT_KNOWN ?? "[]");
const user = userInfo();
const known = [
  homedir(),
  user.homedir,
  user.username,
  hostname(),
  ...Object.entries(process.env)
    .filter(([name, value]) => value !== undefined && isSecretName(name))
    .map(([, value]) => value ?? ""),
  ...(Array.isArray(extra) ? extra.filter((entry): entry is string => typeof entry === "string") : []),
];
const redactor = createTranscriptRedactor(known);
let failed = false;

function record(from: TranscriptLine["from"], line: string): void {
  let message: unknown;
  try {
    message = JSON.parse(line);
  } catch {
    return;
  }
  if (failed) return;
  const text = JSON.stringify({ from, message: redactor.redact(message) } satisfies TranscriptLine);
  try {
    assertRedacted(text, known);
  } catch (error) {
    failed = true;
    writeFileSync(`${out}.failed`, `${error instanceof Error ? error.message : "The redaction check failed."}\n`);
    child.kill("SIGTERM");
    return;
  }
  appendFileSync(out ?? "", `${text}\n`);
}

function tee(source: NodeJS.ReadableStream, target: NodeJS.WritableStream, onLine: (line: string) => void): void {
  let buffer = "";
  source.on("data", (chunk: Buffer) => {
    target.write(chunk);
    buffer += chunk.toString("utf8");
    for (let index = buffer.indexOf("\n"); index >= 0; index = buffer.indexOf("\n")) {
      const line = buffer.slice(0, index).trim();
      buffer = buffer.slice(index + 1);
      if (line) onLine(line);
    }
  });
}

const child = spawn(executable, args, { stdio: ["pipe", "pipe", "inherit"] });
tee(process.stdin, child.stdin, (line) => record("client", line));
tee(child.stdout, process.stdout, (line) => record("agent", line));
process.stdin.on("end", () => child.stdin.end());
for (const signal of ["SIGTERM", "SIGINT", "SIGHUP"] as const) process.on(signal, () => child.kill(signal));
child.on("close", (code, signal) => process.exit(failed ? 1 : (code ?? (signal ? 1 : 0))));
