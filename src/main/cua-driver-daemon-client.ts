// OpenBot's own read-only connection to the Computer Use daemon.
//
// The rim asks the daemon the same two questions many times a second: which agent holds the
// desktop, and where its windows are. The driver's command line answers both, but a command line
// is a process: two spawns for every placement, which is most of the time one placement takes and
// the reason the rim used to trail a window the user drags.
//
// The daemon's own protocol is one JSON object per line over its socket, and the command line is
// only a short-lived client of it. This is a client that stays: one connection, one request in
// flight, and the same answers with no process in the way.
//
// It writes nothing the desktop can feel. `list_windows` and `sessions_list` are reads, and no
// other method is sent from here.

import { connect, type Socket } from "node:net";
import { type DynamicRecord, isDynamicRecord } from "@openbot/contracts/runtime-values";

/** How long one read may take before the connection is given up and the tick keeps the last answer. */
const REQUEST_TIMEOUT_MS = 2_000;
/**
 * A reply longer than this is not an answer to either question the rim asks.
 *
 * The daemon also answers screenshots and accessibility trees on this protocol, which are megabytes
 * long. None of them are asked for here, so the cap is what keeps a daemon that answers something
 * else from growing this buffer without end.
 */
const MAX_RESPONSE_BYTES = 4_194_304;
/** The lease this connection takes, which the daemon keeps alive while the connection is open. */
const SESSION_ID = "openbot-highlight";
/**
 * How this lease is told apart from an agent's in `sessions_list`, which is what keeps the rim from
 * reading its own connection as an agent holding the desktop.
 *
 * By the name, because the daemon reports `client_kind: "direct"` for every client of its socket and
 * keeps no record of the kind each one asked for. The name it does keep, as the last eight
 * characters of the session id.
 */
export const HIGHLIGHT_OWNER_SHORT_ID = SESSION_ID.slice(-8);

/**
 * One request in the daemon's own line protocol, holding only what these reads send.
 *
 * `client_kind` is not optional here: the daemon takes only a known kind, and a request that left
 * it out would be refused. What the daemon reports back for this lease is `direct`, the kind of
 * every client of its socket, which is why the rim tells its own lease apart by name.
 */
interface DaemonReadRequest {
  method: "call" | "sessions_list" | "session_end";
  name?: string;
  args?: DynamicRecord;
  session_id?: string;
  client_kind: "cli";
}

interface PendingRequest {
  resolve: (result: unknown) => void;
  reject: (error: Error) => void;
  timer: ReturnType<typeof setTimeout>;
}

/** The reads the rim needs, over one connection that outlives them. */
export class CuaDriverDaemonClient {
  readonly #socketPath: () => string | null;
  #socket: Socket | null = null;
  #pending: PendingRequest[] = [];
  #buffer = "";

  constructor(socketPath: () => string | null) {
    this.#socketPath = socketPath;
  }

  /**
   * Every window on the desktop, in front-to-back order.
   *
   * The result is the tool's own structured payload, which is what the driver's command line
   * prints, so the readers above it see exactly what they saw before.
   */
  async listWindows(): Promise<unknown> {
    const result = await this.#request({
      method: "call",
      name: "list_windows",
      args: {},
      session_id: SESSION_ID,
      client_kind: "cli",
    });
    return isDynamicRecord(result) ? result.structuredContent : null;
  }

  /**
   * Every live lease the daemon holds, including the agents'.
   *
   * This is the daemon's own view rather than a lease's. A client only ever sees its own sessions
   * through the tools, so the agent's lease - which is what the rim is about - is visible on this
   * method and on no other.
   */
  sessions(): Promise<unknown> {
    return this.#request({ method: "sessions_list", client_kind: "cli" });
  }

  /** Ends the lease and drops the connection. Safe to call when nothing is connected. */
  async close(): Promise<void> {
    const socket = this.#socket;
    if (socket) {
      // Best effort: the daemon drops the lease by itself when a connection ends, and a daemon that
      // has already stopped is the ordinary way this runs at teardown.
      await this.#request({ method: "session_end", session_id: SESSION_ID, client_kind: "cli" }).catch(() => undefined);
    }
    this.#drop(new Error("The Computer Use driver connection was closed."));
  }

  async #request(payload: DaemonReadRequest): Promise<unknown> {
    const socket = await this.#connection();
    return new Promise<unknown>((resolve, reject) => {
      const timer = setTimeout(() => {
        // A late answer would be handed to the next request, because the protocol carries no
        // request id and answers are matched in order. So a read that times out ends the
        // connection rather than leaving it one answer out of step.
        this.#drop(new Error("The Computer Use driver did not answer in time."));
      }, REQUEST_TIMEOUT_MS);
      this.#pending.push({ resolve, reject, timer });
      try {
        socket.write(`${JSON.stringify(payload)}\n`);
      } catch (error) {
        // A daemon that stopped between two reads fails the write before anything says the
        // connection is gone. That read is lost and the connection with it; the next one opens a
        // new connection, which is a single tick of the rim rather than a rim that stays down.
        this.#drop(error instanceof Error ? error : new Error(String(error)));
      }
    });
  }

  async #connection(): Promise<Socket> {
    const existing = this.#socket;
    if (existing && !existing.destroyed) return existing;
    const path = this.#socketPath();
    if (!path) throw new Error("The Computer Use driver is not running.");
    const socket = await new Promise<Socket>((resolve, reject) => {
      const opening = connect(path);
      const fail = (error: Error) => reject(error);
      opening.once("error", fail);
      opening.once("connect", () => {
        opening.removeListener("error", fail);
        resolve(opening);
      });
    });
    this.#socket = socket;
    this.#buffer = "";
    socket.setEncoding("utf8");
    socket.on("data", (chunk: string) => this.#read(chunk));
    socket.on("error", (error) => this.#drop(error));
    socket.on("close", () => this.#drop(new Error("The Computer Use driver closed the connection.")));
    return socket;
  }

  #read(chunk: string): void {
    this.#buffer += chunk;
    let newline = this.#buffer.indexOf("\n");
    while (newline >= 0) {
      const line = this.#buffer.slice(0, newline);
      this.#buffer = this.#buffer.slice(newline + 1);
      this.#answer(line);
      newline = this.#buffer.indexOf("\n");
    }
    if (this.#buffer.length > MAX_RESPONSE_BYTES) {
      this.#drop(new Error("The Computer Use driver answered with more than this connection reads."));
    }
  }

  #answer(line: string): void {
    const pending = this.#pending.shift();
    if (!pending) return;
    clearTimeout(pending.timer);
    let parsed: unknown;
    try {
      parsed = JSON.parse(line);
    } catch {
      pending.reject(new Error("The Computer Use driver answered with no JSON."));
      return;
    }
    if (!isDynamicRecord(parsed) || parsed.ok !== true) {
      const message =
        isDynamicRecord(parsed) && typeof parsed.error === "string" ? parsed.error : "the request was refused";
      pending.reject(new Error(`The Computer Use driver refused a read: ${message}`));
      return;
    }
    pending.resolve(parsed.result);
  }

  /** Ends the connection and fails everything waiting on it. The next read connects again. */
  #drop(error: Error): void {
    const socket = this.#socket;
    this.#socket = null;
    this.#buffer = "";
    const pending = this.#pending;
    this.#pending = [];
    for (const request of pending) {
      clearTimeout(request.timer);
      request.reject(error);
    }
    if (socket) {
      socket.removeAllListeners();
      socket.destroy();
    }
  }
}
