// What OpenBot puts between an agent's driver proxy and the driver daemon.
//
// The daemon answers one lease at a time and tells no lease about another, so OpenBot cannot ask it
// which window an agent works in: `list_sessions` and `get_agent_cursor_state` report only the
// lease that asks, and `history` is refused to anything but the local command line. Front-to-back
// window order is no answer either, because the driver acts in the background by design and leaves
// the order alone, and because the user's own clicks move it.
//
// OpenBot does own one thing: the address it hands the providers. This listens on an address of its
// own, forwards every byte to the daemon unchanged, and reads the few fields it needs out of the
// request line - which application, which window, and which point the agent asked the daemon to
// act on.
//
// It carries no policy. It refuses nothing, rewrites nothing and delays nothing: a tap that could
// change an action would be a second, quieter place where Computer Use is decided.

import { chmod } from "node:fs/promises";
import { connect, createServer, type Server, type Socket } from "node:net";
import { type DynamicRecord, isDynamicRecord } from "@openbot/contracts/runtime-values";

/**
 * A line longer than this is not a request the tap understands, so it stops reading that line.
 *
 * The daemon's answers hold screenshots and accessibility trees and are megabytes long. Those
 * travel the other way and are never parsed, but a client is not trusted to stay small either: the
 * cap is what keeps a client that never sends a newline from growing the buffer without end.
 */
const MAX_REQUEST_LINE_BYTES = 1_048_576;

/**
 * Where an agent last asked the daemon to act.
 *
 * The tool name and two numbers, and nothing else. A request also carries what the agent types,
 * which is the user's own work and belongs to nobody else - so it is read past, never kept and
 * never logged.
 */
export interface ObservedAction {
  /** The driver tool, kept so a log can say why the rim moved without naming a window. */
  tool: string;
  /** The application the action is aimed at, or `null` when the request named none. */
  pid: number | null;
  /** The exact window the action is aimed at, or `null` when the request named none. */
  windowId: number | null;
  /** When the request passed through, from `Date.now()`. */
  at: number;
}

/**
 * Where an agent last aimed the pointer, on the desktop.
 *
 * This is what OpenBot draws its own agent cursor on. It is the point the agent asked for, not
 * where the pointer reached: the driver acts in the background and never moves the user's own
 * pointer there, so the request is the only account of it there is.
 */
export interface ObservedPointer {
  /** The driver tool that named the point, kept so a log can say why the cursor moved. */
  tool: string;
  /** The desktop point, in the same units `list_windows` reports window bounds in. */
  x: number;
  y: number;
  /** When the request passed through, from `Date.now()`. */
  at: number;
}

/** What one request line says about where the agent works, which is at most these two answers. */
export interface ObservedRequest {
  action: ObservedAction | null;
  pointer: ObservedPointer | null;
}

const NOTHING: ObservedRequest = { action: null, pointer: null };

/**
 * The tools that aim the pointer at a point on the desktop.
 *
 * Every other tool with an `x` means something else by it: `set_window_frame` moves a window there
 * and leaves the pointer alone, so a cursor drawn on its arguments would walk away from the work.
 */
const POINTER_TOOLS = new Set(["click", "move_cursor", "scroll"]);

/**
 * What one request line of the daemon's own protocol says.
 *
 * The protocol is one JSON object per line. A tool call is
 * `{"method":"call","name":"click","args":{…}}`; the target sits in the arguments either directly
 * as `pid` and `window_id` or inside a `target` object, and the point sits beside it as `x` and
 * `y`. Anything else - a `list`, a `session_begin`, a call with neither - reports nothing rather
 * than a guess.
 */
export function readRequest(line: string, at: number): ObservedRequest {
  let parsed: unknown;
  try {
    parsed = JSON.parse(line);
  } catch {
    return NOTHING;
  }
  if (!isDynamicRecord(parsed) || parsed.method !== "call") return NOTHING;
  const tool = parsed.name;
  if (typeof tool !== "string") return NOTHING;
  const args: DynamicRecord = isDynamicRecord(parsed.args) ? parsed.args : {};
  return { action: readTarget(tool, args, at), pointer: readPointer(tool, args, at) };
}

function readTarget(tool: string, args: DynamicRecord, at: number): ObservedAction | null {
  const target: DynamicRecord = isDynamicRecord(args.target) ? args.target : {};
  const pid = numberIn(args.pid) ?? numberIn(target.pid);
  const windowId = numberIn(args.window_id) ?? numberIn(target.window_id);
  if (pid === null && windowId === null) return null;
  return { tool, pid, windowId, at };
}

function readPointer(tool: string, args: DynamicRecord, at: number): ObservedPointer | null {
  if (!POINTER_TOOLS.has(tool)) return null;
  const x = numberIn(args.x);
  const y = numberIn(args.y);
  // A click on an element names the element and no point at all, which is the driver's own
  // accessibility route. There is nowhere to draw a cursor then, so none is drawn.
  if (x === null || y === null) return null;
  return { tool, x, y, at };
}

function numberIn(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

export interface ActionTapAddresses {
  /** The daemon's own address, which every forwarded byte goes to. */
  upstream: string;
  /** The address the providers are handed, which this listens on. */
  tap: string;
}

/** Keeps the last action an agent asked for, and forwards everything unchanged. */
export class CuaDriverActionTap {
  #server: Server | null = null;
  #sockets = new Set<Socket>();
  #action: ObservedAction | null = null;
  #pointer: ObservedPointer | null = null;
  #address: string | null = null;
  #now: () => number;

  constructor(now: () => number = Date.now) {
    this.#now = now;
  }

  /** The address to hand the providers, or `null` while nothing listens. */
  get address(): string | null {
    return this.#address;
  }

  /**
   * The last action, while it is recent enough to still say where the agent works.
   *
   * An old action is no answer: an agent that stopped an hour ago would otherwise hold the rim on
   * an application the user has since closed and reopened somewhere else.
   */
  lastAction(maxAgeMs: number): ObservedAction | null {
    const action = this.#action;
    if (!action) return null;
    return this.#now() - action.at <= maxAgeMs ? action : null;
  }

  /**
   * The last point the agent aimed at, while it is recent enough to still be where it works.
   *
   * Kept apart from the action above, because the two questions have different answers: a read
   * names a window and no point, and `move_cursor` names a point and no window. One memory would
   * let either answer take the other's place.
   */
  lastPointer(maxAgeMs: number): ObservedPointer | null {
    const pointer = this.#pointer;
    if (!pointer) return null;
    return this.#now() - pointer.at <= maxAgeMs ? pointer : null;
  }

  async listen({ upstream, tap }: ActionTapAddresses): Promise<void> {
    if (this.#server) return;
    const server = createServer((client) => this.#join(client, upstream));
    this.#server = server;
    await new Promise<void>((resolve, reject) => {
      server.once("error", reject);
      server.listen(tap, () => {
        server.removeListener("error", reject);
        resolve();
      });
    });
    // A listener of its own keeps a failed address from taking the whole main process down: a
    // client that dies mid-request raises `ECONNRESET` on a socket nothing is waiting on.
    server.on("error", () => undefined);
    // The same mode the daemon gives its own socket. This address reaches a process that can drive
    // the whole desktop, and `listen` takes the mode from the umask, which the user owns. The
    // directory around it is already private; both together are what keep the channel private.
    // A Windows named pipe has no file to change, so the failure there is expected and ignored.
    await chmod(tap, 0o600).catch(() => undefined);
    this.#address = tap;
  }

  async close(): Promise<void> {
    const server = this.#server;
    this.#server = null;
    this.#address = null;
    this.#action = null;
    this.#pointer = null;
    for (const socket of this.#sockets) socket.destroy();
    this.#sockets.clear();
    if (!server) return;
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }

  #join(client: Socket, upstream: string): void {
    const daemon = connect(upstream);
    this.#sockets.add(client);
    this.#sockets.add(daemon);
    const end = () => {
      this.#sockets.delete(client);
      this.#sockets.delete(daemon);
      client.destroy();
      daemon.destroy();
    };
    client.on("error", end);
    daemon.on("error", end);
    client.on("close", end);
    daemon.on("close", end);
    // The answers are read by nobody, so they are piped: the stream keeps the back pressure of a
    // screenshot that the agent reads slower than the daemon writes it.
    daemon.pipe(client);
    let pending = "";
    let skipping = false;
    client.on("data", (chunk: Buffer) => {
      daemon.write(chunk);
      pending += chunk.toString("utf8");
      let newline = pending.indexOf("\n");
      while (newline >= 0) {
        const line = pending.slice(0, newline);
        pending = pending.slice(newline + 1);
        if (!skipping) {
          const { action, pointer } = readRequest(line, this.#now());
          if (action) this.#action = action;
          if (pointer) this.#pointer = pointer;
        }
        skipping = false;
        newline = pending.indexOf("\n");
      }
      if (pending.length > MAX_REQUEST_LINE_BYTES) {
        pending = "";
        skipping = true;
      }
    });
  }
}
