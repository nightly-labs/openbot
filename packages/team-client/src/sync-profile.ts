import { errorReference } from "@openbot/user-errors/reference";
import { Cause, type Exit } from "effect";

export interface RemoteRequestRecord {
  route: string;
  method: string;
  transport: "webrtc" | "http";
  startedAt: number;
  respondedAt: number | null;
  endedAt: number;
  requestBytes: number;
  responseBytes: number;
  inFlight: number;
  outcome: "ok" | "error" | "aborted";
  failure?: string;
}

export interface RemoteSyncProfileSink {
  started?(): unknown;
  push(record: RemoteRequestRecord): unknown;
}

export interface RemoteRequestProfile {
  responded(frame: string | number): void;
  end(exit: Exit.Exit<unknown, unknown>): void;
}

const WORD = /^(?:[a-z][a-z-]*|v\d+)$/;
const QUERY_KEY = /^[A-Za-z]+$/;

let installed: RemoteSyncProfileSink | null = null;
let inFlight = 0;
const textEncoder = new TextEncoder();

export function installRemoteSyncProfileSink(sink: RemoteSyncProfileSink | null): void {
  installed = sink;
}

declare global {
  var __openbotSyncProfile: RemoteSyncProfileSink | undefined;
}

function activeSink(): RemoteSyncProfileSink | null {
  return installed ?? globalThis.__openbotSyncProfile ?? null;
}

function now(): number {
  const clock = globalThis.performance;
  return clock && typeof clock.now === "function" && typeof clock.timeOrigin === "number"
    ? clock.timeOrigin + clock.now()
    : Date.now();
}

function byteLength(text: string): number {
  return textEncoder.encode(text).byteLength;
}

export function routeTemplate(path: string): string {
  const queryAt = path.indexOf("?");
  const pathname = queryAt === -1 ? path : path.slice(0, queryAt);
  const segments = pathname.split("/").map((segment) => (segment === "" || WORD.test(segment) ? segment : ":id"));
  if (queryAt === -1) return segments.join("/");
  const keys = path
    .slice(queryAt + 1)
    .split("&")
    .map((pair) => pair.split("=")[0] ?? "")
    .filter((key) => QUERY_KEY.test(key));
  return keys.length > 0 ? `${segments.join("/")}?${keys.join("&")}` : segments.join("/");
}

export function startRemoteRequest(
  method: string,
  path: string,
  frame: string,
  transport: RemoteRequestRecord["transport"] = "webrtc",
): RemoteRequestProfile | null {
  const sink = activeSink();
  if (!sink) return null;
  sink.started?.();
  inFlight += 1;
  const startedAt = now();
  const startInFlight = inFlight;
  let respondedAt: number | null = null;
  let responseBytes = 0;
  let ended = false;
  return {
    responded(response) {
      respondedAt = now();
      responseBytes = typeof response === "number" ? response : byteLength(response);
    },
    end(exit) {
      if (ended) return;
      ended = true;
      inFlight -= 1;
      const outcome = exit._tag === "Success" ? "ok" : Cause.hasInterruptsOnly(exit.cause) ? "aborted" : "error";
      sink.push({
        route: routeTemplate(path),
        method,
        transport,
        startedAt,
        respondedAt,
        endedAt: now(),
        requestBytes: byteLength(frame),
        responseBytes,
        inFlight: startInFlight,
        outcome,
        ...(exit._tag === "Failure" && outcome === "error"
          ? { failure: errorReference(Cause.squash(exit.cause)) ?? "error/unknown" }
          : {}),
      });
    },
  };
}

export function markRemoteSync(name: string): void {
  const clock = globalThis.performance;
  if (!clock || typeof clock.mark !== "function") return;
  const mark = `openbot:remote-${name}`;
  if (typeof clock.clearMarks === "function") clock.clearMarks(mark);
  clock.mark(mark);
}
