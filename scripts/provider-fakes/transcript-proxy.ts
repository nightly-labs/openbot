// Runs a real provider CLI between OpenBot's driver and the CLI, and appends each JSON-RPC line of
// both directions to the transcript named in `TRANSCRIPT_OUT`, redacted. Lines that are not JSON,
// and stderr, are passed through and not recorded. `record-provider-transcript.ts` installs this as
// the provider executable: `bun transcript-proxy.ts <real executable> [args...]`.
//
// A raw line is never written: each line goes through the redactor and then `assertRedacted`. When a
// value of this computer or a token is still in a line, the proxy stops the CLI and writes the reason,
// with no part of the line, to `<TRANSCRIPT_OUT>.failed`, which the recorder reads.
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

// The home folder, the user and computer names, the values of secret variables, and the extra values
// that the recorder names, such as the account email. The recorder sets `HOME` to an empty temporary
// folder, so `homedir()` is that folder; `userInfo()` reads the user database and gives the real home.
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

/** Calls `onLine` for each complete line of a stream, and passes the bytes on unchanged. */
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
// `close` comes after the last stdout data, so the last answer is recorded before the proxy exits.
child.on("close", (code, signal) => process.exit(failed ? 1 : (code ?? (signal ? 1 : 0))));
