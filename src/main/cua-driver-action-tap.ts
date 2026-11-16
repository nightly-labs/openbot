// What OpenBot puts between an agent's driver proxy and the driver daemon.
//
// The daemon answers one lease at a time and tells no lease about another, so OpenBot cannot ask it
// which window an agent works in: `list_sessions` and `get_agent_cursor_state` report only the
// lease that asks, and `history` is refused to anything but the local command line. Front-to-back
// window order is no answer either, because the driver acts in the background by design and leaves
// the order alone, and because the user's own clicks move it.
//
// OpenBot does own one thing: the address it hands the providers. This listens on an address of its
// own, forwards every request byte to the daemon unchanged, and reads the few fields it needs out
// of the request line - which application, which window, and which point the agent asked the
// daemon to act on.
//
// It carries no policy. It refuses nothing and delays no request: a tap that could change an
// action would be a second, quieter place where Computer Use is decided.
//
// It changes one thing on the way back. The answer to a tool call gets one more text item, a JSON
// copy of its `structuredContent`, because some providers show the model only the text and the
// driver's text is a summary with nothing in it to act on. `cua-driver-structured-text.ts` says
// what the copy holds. A refused call also gets its reason in `structuredContent`, because Codex
// shows the model only that. Every other answer, and every other byte of a changed one, passes
// unchanged.
//
// The tool list also loses the tools of the driver's own cursor overlay. OpenBot starts the daemon
// with `--no-overlay` and draws the agent cursor itself, so those tools can change nothing that the
// user sees: on macOS they refuse with a reason about the driver's own host, and on Linux they
// report a change that nothing draws. An agent that a user asked to show its cursor called one,
// read the refusal, and told the user that they could not watch it work (#6478). The driver's
// proxy reads the list once, and a provider offers the model only the tools that it lists. A call
// to a hidden tool still passes, because the tap refuses nothing.
//
// It also times each tool call, from the request line to the end of its answer line, and logs the
// tool name and the milliseconds. That is the driver's share of a slow Computer Use step; the rest
// of the step is the model, which the tap cannot see.

import { chmod } from "node:fs/promises";
import { connect, createServer, type Server, type Socket } from "node:net";
import { Transform, type TransformCallback } from "node:stream";
import { type DynamicRecord, isDynamicRecord } from "@openbot/contracts/runtime-values";
import { createOpenBotLogger, type Logger } from "@openbot/logging";
import { Effect, Result } from "effect";
import { CuaDriverFailure, cuaIO } from "./cua-driver-effects";
import { parseAnswerLine, rewriteCallAnswer } from "./cua-driver-structured-text";

/**
 * A line longer than this is not a request the tap understands, so it stops reading that line.
 *
 * The daemon's answers hold screenshots and accessibility trees and are megabytes long. Those
 * travel the other way and are never parsed, but a client is not trusted to stay small either: the
 * cap is what keeps a client that never sends a newline from growing the buffer without end.
 */
const MAX_REQUEST_LINE_BYTES = 1_048_576;

/**
 * An answer line longer than this is passed on unchanged rather than held whole to be read.
 *
 * A tool answer must be held to its end before a text item can be added to it, and a window state
 * with a screenshot is several megabytes. The cap keeps a daemon that never sends a newline from
 * growing the held answer without end; an answer past it reaches the agent as the daemon sent it.
 */
const MAX_ANSWER_LINE_BYTES = 33_554_432;
const NEWLINE = 0x0a;

/**
 * A tool call that takes at least this long is logged at `info`, so the default log shows it.
 * Faster calls are logged at `debug` only, because a Computer Use turn makes many of them.
 */
const SLOW_CALL_MS = 5_000;

/** How many windows keep the width of their last screenshot. An agent works in a few at a time. */
const MAX_SCREENSHOT_WINDOWS = 32;

const defaultLogger = createOpenBotLogger("cua-driver-tap");

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
  /**
   * The window whose own last screenshot `x` and `y` are pixels of, or `null` when they are a
   * desktop point in the units `list_windows` reports window bounds in.
   *
   * A click or a scroll aimed at a window names a pixel of that window's screenshot, which is the
   * driver's default. Read as a desktop point, it put the cursor on the main display while the
   * agent worked on another one (#7511).
   */
  windowId: number | null;
  /**
   * The width of that window's last screenshot when the request passed, or `null` for a desktop
   * point. Kept with the point, because a later screenshot of another size must not move it.
   */
  screenshotWidth: number | null;
  x: number;
  y: number;
  /** When the request passed through, from `Date.now()`. */
  at: number;
}

/** What one request line says: whether it is a tool call, and at most two answers about where the agent works. */
interface ObservedRequest {
  /**
   * The tool a call names, or `null` when the line is no tool call. A call's answer gets the text
   * copy of its structured result, and the tap logs how long that answer took.
   */
  tool: string | null;
  /** Whether the line asks for the tool list, whose answer loses the driver's cursor tools. */
  list: boolean;
  action: ObservedAction | null;
  /** The point, `"unplaced"` for a point that cannot be placed, or `null` when the line names none. */
  pointer: ObservedPointer | "unplaced" | null;
}

const NOTHING: ObservedRequest = { tool: null, list: false, action: null, pointer: null };
const TOOL_LIST: ObservedRequest = { ...NOTHING, list: true };

/**
 * The tools of the driver's own cursor overlay, which `--no-overlay` turns off on every platform.
 * `move_cursor` is not one of them: it also moves the real pointer, and OpenBot draws its own
 * cursor at the point that the call names.
 */
const DRIVER_CURSOR_TOOLS = new Set([
  "set_agent_cursor_enabled",
  "set_agent_cursor_motion",
  "set_agent_cursor_theme",
  "get_agent_cursor_state",
]);

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
 * `y`. A `list` asks for the tool list. Anything else - a `session_begin`, a call with neither -
 * reports nothing rather than a guess.
 */
function readRequest(line: string, at: number, screenshotWidth: (windowId: number) => number | null): ObservedRequest {
  let parsed: unknown;
  try {
    parsed = JSON.parse(line);
  } catch {
    return NOTHING;
  }
  if (isDynamicRecord(parsed) && parsed.method === "list") return TOOL_LIST;
  if (!isDynamicRecord(parsed) || parsed.method !== "call") return NOTHING;
  const tool = parsed.name;
  if (typeof tool !== "string") return NOTHING;
  const args: DynamicRecord = isDynamicRecord(parsed.args) ? parsed.args : {};
  return {
    tool,
    list: false,
    action: readTarget(tool, args, at),
    pointer: readPointer(tool, args, at, screenshotWidth),
  };
}

function readTarget(tool: string, args: DynamicRecord, at: number): ObservedAction | null {
  const target: DynamicRecord = isDynamicRecord(args.target) ? args.target : {};
  const pid = numberIn(args.pid) ?? numberIn(target.pid);
  const windowId = numberIn(args.window_id) ?? numberIn(target.window_id);
  if (pid === null && windowId === null) return null;
  return { tool, pid, windowId, at };
}

function readPointer(
  tool: string,
  args: DynamicRecord,
  at: number,
  screenshotWidth: (windowId: number) => number | null,
): ObservedPointer | "unplaced" | null {
  if (!POINTER_TOOLS.has(tool)) return null;
  const x = numberIn(args.x);
  const y = numberIn(args.y);
  // A click on an element names the element and no point at all, which is the driver's own
  // accessibility route. There is nowhere to draw a cursor then, so none is drawn.
  if (x === null || y === null) return null;
  const windowId = pointerWindow(tool, args);
  if (windowId === undefined) return "unplaced";
  if (windowId === null) return { tool, windowId, screenshotWidth: null, x, y, at };
  const width = screenshotWidth(windowId);
  return width === null ? "unplaced" : { tool, windowId, screenshotWidth: width, x, y, at };
}

/**
 * The window whose screenshot pixels a point is in, `null` for a desktop point, or `undefined` when
 * the request does not say enough to place it.
 *
 * `move_cursor` names a desktop point in each of its scopes. A click or a scroll names one only in
 * the desktop frame, or when it names no application at all; otherwise the point is in the
 * window's own screenshot. A point in a zoomed image, or in a window that the request does not
 * name, has no place OpenBot can work out, and a cursor in the wrong place is worse than none.
 */
function pointerWindow(tool: string, args: DynamicRecord): number | null | undefined {
  if (tool === "move_cursor") return null;
  const target: DynamicRecord = isDynamicRecord(args.target) ? args.target : {};
  if (args.scope === "desktop" || args.coordinate_frame === "desktop" || target.kind === "desktop") return null;
  const windowId = numberIn(args.window_id) ?? numberIn(target.window_id);
  if (windowId === null && numberIn(args.pid) === null && numberIn(target.pid) === null) return null;
  if (windowId === null || args.from_zoom === true) return undefined;
  return windowId;
}

/** The window and the width of a `get_window_state` screenshot, from its structured result. */
function screenshotOf(answer: DynamicRecord): { windowId: number; width: number } | null {
  const result = answer.ok === true && isDynamicRecord(answer.result) ? answer.result : null;
  const structured = result && isDynamicRecord(result.structuredContent) ? result.structuredContent : null;
  const windowId = numberIn(structured?.window_id);
  const width = numberIn(structured?.screenshot_width);
  return windowId !== null && width !== null && width > 0 ? { windowId, width } : null;
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

/** A tool call the daemon has not answered yet: its tool, and when the request passed through. */
interface PendingCall {
  tool: string;
  at: number;
}

/** A request whose answer the tap changes: a tool call, or `"list"` for the tool list. */
type ExpectedAnswer = PendingCall | "list";

/**
 * The daemon's answers, one line at a time, with the text copy added to each tool call's answer
 * and the driver's cursor tools taken out of the tool list.
 *
 * The protocol carries no request id: the daemon answers in the order it was asked, so the answer
 * lines are matched to the request lines in order. `expect` is told about each request before the
 * daemon can answer it. A line that answers no tool call and no list is passed on as it arrives;
 * the others are held to their newline, because only a whole answer can be changed.
 * The stream's own back pressure holds the daemon while the agent reads slower than it writes.
 */
class CallAnswerLines extends Transform {
  /** One entry per request not yet answered: its tool call or the list, or `null` for any other request. */
  readonly #expected: Array<ExpectedAnswer | null> = [];
  /** How the current line is handled, or `null` before its first byte. */
  #line: "pass" | "hold" | null = null;
  /** The request the current line answers, or `null` when it answers no request that the tap changes. */
  #answering: ExpectedAnswer | null = null;
  #held: Buffer[] = [];
  #heldBytes = 0;
  readonly #answered: (tool: string, ms: number) => void;
  readonly #captured: (windowId: number, width: number) => void;
  readonly #now: () => number;

  constructor(
    answered: (tool: string, ms: number) => void,
    captured: (windowId: number, width: number) => void,
    now: () => number,
  ) {
    super();
    this.#answered = answered;
    this.#captured = captured;
    this.#now = now;
  }

  expect(request: ExpectedAnswer | null): void {
    this.#expected.push(request);
  }

  /** The tool calls still waiting for their answer, oldest first. Each is returned only once. */
  takeUnanswered(): PendingCall[] {
    const calls = [this.#answering, ...this.#expected].filter(
      (call): call is PendingCall => call !== null && call !== "list",
    );
    this.#answering = null;
    this.#expected.length = 0;
    return calls;
  }

  override _transform(chunk: Buffer, _encoding: BufferEncoding, callback: TransformCallback): void {
    let start = 0;
    while (start < chunk.length) {
      // An answer that arrives with no request to match reads as not a call. The copy also checks
      // the structure of the answer, so a line out of step is at worst left unchanged.
      if (this.#line === null) {
        this.#answering = this.#expected.shift() ?? null;
        this.#line = this.#answering ? "hold" : "pass";
      }
      const newline = chunk.indexOf(NEWLINE, start);
      const end = newline < 0 ? chunk.length : newline + 1;
      const piece = chunk.subarray(start, end);
      start = end;
      if (this.#line === "pass") {
        this.push(piece);
      } else {
        this.#held.push(piece);
        this.#heldBytes += piece.length;
        if (this.#heldBytes > MAX_ANSWER_LINE_BYTES) {
          this.#release(false);
          this.#line = "pass";
        }
      }
      if (newline >= 0) {
        if (this.#line === "hold") this.#release(true);
        const answering = this.#answering;
        if (answering && answering !== "list") this.#answered(answering.tool, this.#now() - answering.at);
        this.#answering = null;
        this.#line = null;
      }
    }
    callback();
  }

  override _flush(callback: TransformCallback): void {
    // A last answer with no newline is not a whole line, so it goes on as the daemon sent it.
    this.#release(false);
    callback();
  }

  #release(whole: boolean): void {
    if (this.#heldBytes === 0) return;
    const line = Buffer.concat(this.#held, this.#heldBytes);
    this.#held = [];
    this.#heldBytes = 0;
    if (!whole) this.push(line);
    else if (this.#answering === "list") this.push(withoutDriverCursorTools(line));
    else this.push(withCopy(line, this.#answering?.tool === "get_window_state" ? this.#readScreenshot : undefined));
  }

  /** Keeps the width of a window screenshot, which scales the pixels a later click names. */
  readonly #readScreenshot = (answer: DynamicRecord): void => {
    const screenshot = screenshotOf(answer);
    if (screenshot) this.#captured(screenshot.windowId, screenshot.width);
  };
}

/** One whole tool list answer line, ending in its newline, less the tools in `DRIVER_CURSOR_TOOLS`. */
function withoutDriverCursorTools(line: Buffer): Buffer {
  if (!line.includes("agent_cursor")) return line;
  const parsed = parseAnswerLine(line.toString("utf8", 0, line.length - 1));
  const result = parsed?.ok === true ? parsed.result : null;
  if (!parsed || !isDynamicRecord(result) || !Array.isArray(result.tools)) return line;
  const tools = result.tools.filter(
    (tool) => !(isDynamicRecord(tool) && typeof tool.name === "string" && DRIVER_CURSOR_TOOLS.has(tool.name)),
  );
  if (tools.length === result.tools.length) return line;
  return Buffer.from(`${JSON.stringify({ ...parsed, result: { ...result, tools } })}\n`, "utf8");
}

/**
 * One whole answer line, ending in its newline, with the copy added when there is one to add.
 * `read` is given the parsed answer, so a field the tap keeps costs no second parse.
 */
function withCopy(line: Buffer, read?: (answer: DynamicRecord) => void): Buffer {
  // Most answers have no structured result and are no refusal or error, and this search costs far less than the parse.
  if (!line.includes('"structuredContent"') && !line.includes('"ok":false') && !line.includes('"isError":true'))
    return line;
  const parsed = parseAnswerLine(line.toString("utf8", 0, line.length - 1));
  if (!parsed) return line;
  read?.(parsed);
  const rewritten = rewriteCallAnswer(parsed);
  return rewritten === null ? line : Buffer.from(`${rewritten}\n`, "utf8");
}

/** Keeps the last action an agent asked for, and forwards everything else unchanged. */
export class CuaDriverActionTap {
  #server: Server | null = null;
  #sockets = new Set<Socket>();
  #action: ObservedAction | null = null;
  #pointer: ObservedPointer | null = null;
  /** The width of each window's last screenshot, by window id, oldest first. */
  #screenshotWidths = new Map<number, number>();
  #address: string | null = null;
  #now: () => number;
  #logger: Logger;

  constructor(now: () => number = Date.now, logger: Logger = defaultLogger) {
    this.#now = now;
    this.#logger = logger;
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

  /** The width of the last screenshot of one window that an agent read, or `null` when none passed. */
  #screenshotWidth(windowId: number): number | null {
    return this.#screenshotWidths.get(windowId) ?? null;
  }

  listen = Effect.fn("CuaDriverActionTap.listen")(function* (
    this: CuaDriverActionTap,
    { upstream, tap }: ActionTapAddresses,
  ) {
    if (this.#server) return;
    const server = createServer((client) => this.#join(client, upstream));
    this.#server = server;
    const result = yield* Effect.result(
      Effect.callback<void, CuaDriverFailure>((resume) => {
        const fail = (cause: Error) => resume(Effect.fail(new CuaDriverFailure({ cause })));
        const ready = () => {
          server.removeListener("error", fail);
          resume(Effect.void);
        };
        server.once("error", fail);
        server.listen(tap, ready);
        return Effect.sync(() => {
          server.removeListener("error", fail);
          server.removeListener("listening", ready);
        });
      }),
    );
    // Keep the listener safe after it is acquired and while it is closed after a bind failure.
    server.on("error", () => undefined);
    if (Result.isFailure(result)) {
      yield* this.close();
      return yield* result.failure;
    }
    yield* cuaIO(() => chmod(tap, 0o600)).pipe(Effect.catch(() => Effect.void));
    this.#address = tap;
  }, Effect.uninterruptible);

  close = Effect.fn("CuaDriverActionTap.close")(function* (this: CuaDriverActionTap) {
    const server = this.#server;
    this.#server = null;
    this.#address = null;
    this.#action = null;
    this.#pointer = null;
    this.#screenshotWidths.clear();
    for (const socket of this.#sockets) socket.destroy();
    this.#sockets.clear();
    if (!server) return;
    yield* Effect.callback<void>((resume) => {
      server.close(() => resume(Effect.void));
    });
  }, Effect.uninterruptible);

  #join(client: Socket, upstream: string): void {
    const daemon = connect(upstream);
    this.#sockets.add(client);
    this.#sockets.add(daemon);
    const answers = new CallAnswerLines(
      (tool, ms) => this.#logAnswered(tool, ms),
      (windowId, width) => this.#keepScreenshotWidth(windowId, width),
      this.#now,
    );
    const end = () => {
      // A call that hangs in the driver ends here, when the agent gives up and closes the connection.
      for (const call of answers.takeUnanswered()) this.#logUnanswered(call.tool, this.#now() - call.at);
      this.#sockets.delete(client);
      this.#sockets.delete(daemon);
      client.destroy();
      daemon.destroy();
    };
    client.on("error", end);
    daemon.on("error", end);
    client.on("close", end);
    // A daemon that closes cleanly can still have its last answer inside `answers`, held while the
    // agent reads slowly. The pipe ends the client after that answer, and the client's own close
    // then ends both; destroying the client here would cut the answer off.
    daemon.on("close", (hadError: boolean) => {
      if (hadError) end();
    });
    // Piped, so the stream keeps the back pressure of a screenshot that the agent reads slower than
    // the daemon writes it.
    daemon.pipe(answers).pipe(client);
    let pending = "";
    let skipping = false;
    client.on("data", (chunk: Buffer) => {
      daemon.write(chunk);
      pending += chunk.toString("utf8");
      let newline = pending.indexOf("\n");
      while (newline >= 0) {
        const line = pending.slice(0, newline);
        pending = pending.slice(newline + 1);
        // Told before the daemon can answer, because this runs in the same turn as the write above.
        if (skipping) {
          answers.expect(null);
        } else {
          const at = this.#now();
          const { tool, list, action, pointer } = readRequest(line, at, (windowId) => this.#screenshotWidth(windowId));
          answers.expect(list ? "list" : tool === null ? null : { tool, at });
          if (action) this.#action = action;
          // A point that cannot be placed takes the cursor down: the old one is no longer where the agent works.
          if (pointer) this.#pointer = pointer === "unplaced" ? null : pointer;
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

  /** Kept for the windows read last only, so a long session does not grow the map without end. */
  #keepScreenshotWidth(windowId: number, width: number): void {
    this.#screenshotWidths.delete(windowId);
    this.#screenshotWidths.set(windowId, width);
    const oldest = this.#screenshotWidths.keys().next();
    if (this.#screenshotWidths.size > MAX_SCREENSHOT_WINDOWS && !oldest.done)
      this.#screenshotWidths.delete(oldest.value);
  }

  /** The tool name and the time only: the arguments are the user's work and are never logged. */
  #logAnswered(tool: string, ms: number): void {
    const log = ms >= SLOW_CALL_MS ? this.#logger.info : this.#logger.debug;
    log("Computer Use driver answered", { tool, ms });
  }

  #logUnanswered(tool: string, ms: number): void {
    this.#logger.info("Computer Use driver did not answer", { tool, ms });
  }
}
