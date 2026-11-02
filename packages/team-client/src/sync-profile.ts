// A development measurement of the requests a client sends to a remote host while it connects and
// syncs. `bun run perf:remote` installs a sink and reads it back. Without a sink every request call
// returns at once, so a released build records no request. `markRemoteSync` sets its fixed-name marks
// in each build: a few for each connect, never for each request.
//
// A record holds a route template, never a raw path: each segment that is not a lowercase word
// becomes `:id`, and query values are dropped. Records still never go to the trace file, the logs
// or analytics. They stay in the sink's memory, or in the development file that desktop main writes.
// A failure keeps only its `errorReference` code, such as `http/503` or `error/RemotePeerError`.

import { errorReference } from "@openbot/user-errors/reference";
import { Cause, type Exit } from "effect";

/** One request to the host, timed from send to the end of decoding. Times are epoch milliseconds. */
export interface RemoteRequestRecord {
  route: string;
  method: string;
  /** `http` is the HTTPS arm of desktop main, which the dev test client uses without a WebRTC membership. */
  transport: "webrtc" | "http";
  startedAt: number;
  respondedAt: number | null;
  endedAt: number;
  requestBytes: number;
  responseBytes: number;
  /** Requests in flight when this one started, this one included. */
  inFlight: number;
  /** `aborted`: the caller stopped waiting, as when a newer read replaced this one. */
  outcome: "ok" | "error" | "aborted";
  /** Set for `error` only: a code made of fixed identifiers, never a message, a URL or a host. */
  failure?: string;
}

export interface RemoteSyncProfileSink {
  /** A request went out. With `push`, it tells the harness how many requests are in flight. */
  started?(): unknown;
  push(record: RemoteRequestRecord): unknown;
}

/** The handle of one request in flight. `null` when nothing records. */
export interface RemoteRequestProfile {
  /** The response frame, or its byte count when the client reads no frame text. */
  responded(frame: string | number): void;
  end(exit: Exit.Exit<unknown, unknown>): void;
}

// A route word, or a version segment such as `v1`. A UUID or an encoded id holds a digit or `%`.
const WORD = /^(?:[a-z][a-z-]*|v\d+)$/;
const QUERY_KEY = /^[A-Za-z]+$/;

let installed: RemoteSyncProfileSink | null = null;
let inFlight = 0;

/** Desktop main installs its file sink here. Web and the harness use `globalThis.__openbotSyncProfile`. */
export function installRemoteSyncProfileSink(sink: RemoteSyncProfileSink | null): void {
  installed = sink;
}

declare global {
  // The sink that the `perf:remote` harness installs in a web page before the app loads.
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
  return new TextEncoder().encode(text).byteLength;
}

/** `/v1/agents/<uuid>/conversation?limit=50` becomes `/v1/agents/:id/conversation?limit`. */
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

/** Starts the record of one request. The frame is the encoded request as it goes out. */
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

/**
 * Marks a connect or sync phase with `performance.mark("openbot:remote-<name>")`. The name is a fixed
 * word, never data. Only the latest mark of each name stays, so a tab that reconnects for days keeps
 * no more marks. React Native can lack the User Timing API; the mark is then skipped.
 */
export function markRemoteSync(name: string): void {
  const clock = globalThis.performance;
  if (!clock || typeof clock.mark !== "function") return;
  const mark = `openbot:remote-${name}`;
  if (typeof clock.clearMarks === "function") clock.clearMarks(mark);
  clock.mark(mark);
}
