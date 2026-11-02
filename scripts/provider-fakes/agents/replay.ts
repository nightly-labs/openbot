// Replays a transcript of a real provider CLI that `record-provider-transcript.ts` wrote. The path is
// in `TRANSCRIPT`. Each request from the client takes the next recorded client request with the same
// method. The agent then sends what the real CLI sent for it: the recorded messages up to the answer,
// with the answer's id changed to the live id, and the notifications that followed before the next
// recorded request. Each recorded message is sent once.
//
// A request with no recorded match gets a JSON-RPC error. `FAKE_LOG` gets one entry per request.
import { readFileSync } from "node:fs";
import { logEntry } from "../acp-agent";
import type { TranscriptLine } from "../transcript-proxy";
import type { TranscriptJsonObject } from "../transcript-redaction";

interface RecordedMessage {
  /** The whole recorded message, as the agent sends it. */
  raw: TranscriptJsonObject;
  id?: number | string;
  method?: string;
}

const path = process.env.TRANSCRIPT;
if (!path) throw new Error("TRANSCRIPT names no transcript.");
const lines: TranscriptLine[] = readFileSync(path, "utf8")
  .split("\n")
  .filter(Boolean)
  .slice(1)
  .map((line): TranscriptLine => JSON.parse(line));
const message = (index: number): RecordedMessage => {
  const raw = lines[index]?.message;
  if (raw === null || typeof raw !== "object" || Array.isArray(raw)) return { raw: {} };
  const { id, method } = raw;
  return {
    raw,
    ...(typeof id === "number" || typeof id === "string" ? { id } : {}),
    ...(typeof method === "string" ? { method } : {}),
  };
};
// A client notification, such as `session/cancel`, has no id and gets no answer, so it is not a request.
const isRequest = (index: number) =>
  lines[index]?.from === "client" && message(index).method !== undefined && message(index).id !== undefined;

const used = new Set<number>();
const sent = new Set<number>();
const write = (value: unknown) => process.stdout.write(`${JSON.stringify(value)}\n`);

function answer(live: { id: number | string; method: string }): void {
  let start = 0;
  while (start < lines.length && !(isRequest(start) && !used.has(start) && message(start).method === live.method)) {
    start += 1;
  }
  if (start >= lines.length) {
    logEntry({ event: "unmatched", method: live.method });
    write({ jsonrpc: "2.0", id: live.id, error: { code: -32601, message: `No recorded ${live.method}.` } });
    return;
  }
  used.add(start);
  logEntry({ event: "request", method: live.method });
  const recordedId = message(start).id;
  let answered = false;
  for (let index = start + 1; index < lines.length; index += 1) {
    if (answered && isRequest(index)) break;
    const entry = message(index);
    if (lines[index]?.from !== "agent" || sent.has(index)) continue;
    const isAnswer = entry.method === undefined && entry.id !== undefined;
    // An answer to another request waits for that request, and what came after it waits too.
    if (isAnswer && entry.id !== recordedId) {
      if (answered) break;
      continue;
    }
    sent.add(index);
    write(isAnswer ? { ...entry.raw, id: live.id } : entry.raw);
    if (isAnswer) answered = true;
  }
}

let buffer = "";
process.stdin.setEncoding("utf8");
process.stdin.on("data", (chunk: string) => {
  buffer += chunk;
  for (let index = buffer.indexOf("\n"); index >= 0; index = buffer.indexOf("\n")) {
    const line = buffer.slice(0, index).trim();
    buffer = buffer.slice(index + 1);
    if (!line) continue;
    const incoming: { id?: number | string; method?: unknown } = JSON.parse(line);
    if (incoming.id !== undefined && typeof incoming.method === "string") {
      answer({ id: incoming.id, method: incoming.method });
    }
  }
});
// A real agent runs until the client stops it, also after stdin ends.
setInterval(() => {}, 1000);
