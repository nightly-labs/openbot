import { chmod } from "node:fs/promises";
import { connect, createServer, type Server, type Socket } from "node:net";
import { Transform, type TransformCallback } from "node:stream";
import { type DynamicRecord, isDynamicRecord } from "@openbot/contracts/runtime-values";
import { createOpenBotLogger, type Logger } from "@openbot/logging";
import { Effect, Result } from "effect";
import { CuaDriverFailure, cuaIO } from "./cua-driver-effects";
import { parseAnswerLine, rewriteCallAnswer } from "./cua-driver-structured-text";

const MAX_REQUEST_LINE_BYTES = 1_048_576;

const MAX_ANSWER_LINE_BYTES = 33_554_432;
const NEWLINE = 0x0a;

const SLOW_CALL_MS = 5_000;

const MAX_SCREENSHOT_WINDOWS = 32;

const defaultLogger = createOpenBotLogger("cua-driver-tap");

export interface ObservedAction {
  tool: string;
  pid: number | null;
  windowId: number | null;
  at: number;
}

export interface ObservedPointer {
  tool: string;
  windowId: number | null;
  screenshotWidth: number | null;
  x: number;
  y: number;
  at: number;
}

interface ObservedRequest {
  tool: string | null;
  list: boolean;
  action: ObservedAction | null;
  pointer: ObservedPointer | "unplaced" | null;
}

const NOTHING: ObservedRequest = { tool: null, list: false, action: null, pointer: null };
const TOOL_LIST: ObservedRequest = { ...NOTHING, list: true };

const DRIVER_CURSOR_TOOLS = new Set([
  "set_agent_cursor_enabled",
  "set_agent_cursor_motion",
  "set_agent_cursor_theme",
  "get_agent_cursor_state",
]);

const POINTER_TOOLS = new Set(["click", "move_cursor", "scroll"]);

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
  if (tool === RUN_STEPS_TOOL) return { tool, list: false, ...readSteps(args, at, screenshotWidth) };
  return {
    tool,
    list: false,
    action: readTarget(tool, args, at),
    pointer: readPointer(tool, args, at, screenshotWidth),
  };
}

const RUN_STEPS_TOOL = "run_steps";
const STEP_KEYS = new Set(["tool", "args", "wait_for", "expect", "timeout_ms"]);
const WINDOW_KEYS = ["pid", "window_id", "app", "window"] as const;

function readSteps(
  args: DynamicRecord,
  at: number,
  screenshotWidth: (windowId: number) => number | null,
): Pick<ObservedRequest, "action" | "pointer"> {
  let context = windowOf(args);
  let action: ObservedAction | null = null;
  let pointer: ObservedPointer | "unplaced" | null = null;
  for (const raw of Array.isArray(args.steps) ? args.steps : []) {
    const step = readStep(raw);
    if (!step) continue;
    const named = windowOf(step.args);
    if (named) context = named;
    const stepArgs = named || !context ? step.args : { ...context, ...step.args };
    action = readTarget(step.tool, stepArgs, at) ?? action;
    pointer = readPointer(step.tool, stepArgs, at, screenshotWidth) ?? pointer;
  }
  return { action, pointer };
}

function readStep(raw: unknown): { tool: string; args: DynamicRecord } | null {
  if (!isDynamicRecord(raw)) return null;
  if (typeof raw.tool === "string") {
    if (isDynamicRecord(raw.args)) return { tool: raw.tool, args: raw.args };
    return { tool: raw.tool, args: Object.fromEntries(Object.entries(raw).filter(([key]) => !STEP_KEYS.has(key))) };
  }
  const named = Object.keys(raw).filter((key) => !STEP_KEYS.has(key));
  const tool = named[0];
  if (named.length !== 1 || tool === undefined) return null;
  const args = raw[tool];
  return isDynamicRecord(args) ? { tool, args } : null;
}

function windowOf(args: DynamicRecord): DynamicRecord | null {
  const fields = WINDOW_KEYS.filter((key) => args[key] !== undefined && args[key] !== null);
  return fields.length > 0 ? Object.fromEntries(fields.map((key) => [key, args[key]])) : null;
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
  if (x === null || y === null) return null;
  const windowId = pointerWindow(tool, args);
  if (windowId === undefined) return "unplaced";
  if (windowId === null) return { tool, windowId, screenshotWidth: null, x, y, at };
  const width = screenshotWidth(windowId);
  return width === null ? "unplaced" : { tool, windowId, screenshotWidth: width, x, y, at };
}

function pointerWindow(tool: string, args: DynamicRecord): number | null | undefined {
  if (tool === "move_cursor") return null;
  const target: DynamicRecord = isDynamicRecord(args.target) ? args.target : {};
  if (args.scope === "desktop" || args.coordinate_frame === "desktop" || target.kind === "desktop") return null;
  const windowId = numberIn(args.window_id) ?? numberIn(target.window_id);
  if (windowId === null && (typeof args.app === "string" || typeof args.window === "string")) return undefined;
  if (windowId === null && numberIn(args.pid) === null && numberIn(target.pid) === null) return null;
  if (windowId === null || args.from_zoom === true) return undefined;
  return windowId;
}

const SCREENSHOT_TOOLS = new Set(["get_window_state", RUN_STEPS_TOOL]);

function screenshotOf(answer: DynamicRecord): { windowId: number; width: number } | null {
  const result = answer.ok === true && isDynamicRecord(answer.result) ? answer.result : null;
  const structured = result && isDynamicRecord(result.structuredContent) ? result.structuredContent : null;
  const observation = structured && isDynamicRecord(structured.observation) ? structured.observation : null;
  const state = observation && isDynamicRecord(observation.state) ? observation.state : structured;
  const windowId = numberIn(state?.window_id);
  const width = numberIn(state?.screenshot_width);
  return windowId !== null && width !== null && width > 0 ? { windowId, width } : null;
}

function numberIn(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

export interface ActionTapAddresses {
  upstream: string;
  tap: string;
}

interface PendingCall {
  tool: string;
  at: number;
}

type ExpectedAnswer = PendingCall | "list";

class CallAnswerLines extends Transform {
  readonly #expected: Array<ExpectedAnswer | null> = [];
  #line: "pass" | "hold" | null = null;
  #answering: ExpectedAnswer | null = null;
  #held: Buffer[] = [];
  #heldBytes = 0;
  readonly #answered: (tool: string, ms: number) => void;
  readonly #captured: (windowId: number, width: number) => void;
  readonly #refused: () => void;
  readonly #now: () => number;

  constructor(
    answered: (tool: string, ms: number) => void,
    captured: (windowId: number, width: number) => void,
    refused: () => void,
    now: () => number,
  ) {
    super();
    this.#answered = answered;
    this.#captured = captured;
    this.#refused = refused;
    this.#now = now;
  }

  expect(request: ExpectedAnswer | null): void {
    this.#expected.push(request);
  }

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
    else {
      this.push(withCopy(line, SCREENSHOT_TOOLS.has(this.#answering?.tool ?? "") ? this.#readScreenshot : undefined));
      if (isAccessibilityRefusal(line)) this.#refused();
    }
  }

  readonly #readScreenshot = (answer: DynamicRecord): void => {
    const screenshot = screenshotOf(answer);
    if (screenshot) this.#captured(screenshot.windowId, screenshot.width);
  };
}

function isAccessibilityRefusal(line: Buffer): boolean {
  if (!line.includes("kAXErrorAPIDisabled") && !line.includes("AXError -25211")) return false;
  return line.includes('"ok":false') || line.includes('"isError":true');
}

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

function withCopy(line: Buffer, read?: (answer: DynamicRecord) => void): Buffer {
  if (!line.includes('"structuredContent"') && !line.includes('"ok":false') && !line.includes('"isError":true'))
    return line;
  const parsed = parseAnswerLine(line.toString("utf8", 0, line.length - 1));
  if (!parsed) return line;
  read?.(parsed);
  const rewritten = rewriteCallAnswer(parsed);
  return rewritten === null ? line : Buffer.from(`${rewritten}\n`, "utf8");
}

export class CuaDriverActionTap {
  #server: Server | null = null;
  #sockets = new Set<Socket>();
  #action: ObservedAction | null = null;
  #pointer: ObservedPointer | null = null;
  #screenshotWidths = new Map<number, number>();
  #address: string | null = null;
  #now: () => number;
  #logger: Logger;
  #onAccessibilityRefused: (() => void) | null = null;
  #onToolCall: (() => void) | null = null;

  constructor(now: () => number = Date.now, logger: Logger = defaultLogger) {
    this.#now = now;
    this.#logger = logger;
  }

  onAccessibilityRefused(listener: () => void): void {
    this.#onAccessibilityRefused = listener;
  }

  onToolCall(listener: () => void): void {
    this.#onToolCall = listener;
  }

  get address(): string | null {
    return this.#address;
  }

  lastAction(maxAgeMs: number): ObservedAction | null {
    const action = this.#action;
    if (!action) return null;
    return this.#now() - action.at <= maxAgeMs ? action : null;
  }

  lastPointer(maxAgeMs: number): ObservedPointer | null {
    const pointer = this.#pointer;
    if (!pointer) return null;
    return this.#now() - pointer.at <= maxAgeMs ? pointer : null;
  }

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
      () => this.#onAccessibilityRefused?.(),
      this.#now,
    );
    const end = () => {
      for (const call of answers.takeUnanswered()) this.#logUnanswered(call.tool, this.#now() - call.at);
      this.#sockets.delete(client);
      this.#sockets.delete(daemon);
      client.destroy();
      daemon.destroy();
    };
    client.on("error", end);
    daemon.on("error", end);
    client.on("close", end);
    daemon.on("close", (hadError: boolean) => {
      if (hadError) end();
    });
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
        if (skipping) {
          answers.expect(null);
        } else {
          const at = this.#now();
          const { tool, list, action, pointer } = readRequest(line, at, (windowId) => this.#screenshotWidth(windowId));
          answers.expect(list ? "list" : tool === null ? null : { tool, at });
          if (tool !== null) this.#onToolCall?.();
          if (action) this.#action = action;
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

  #keepScreenshotWidth(windowId: number, width: number): void {
    this.#screenshotWidths.delete(windowId);
    this.#screenshotWidths.set(windowId, width);
    const oldest = this.#screenshotWidths.keys().next();
    if (this.#screenshotWidths.size > MAX_SCREENSHOT_WINDOWS && !oldest.done)
      this.#screenshotWidths.delete(oldest.value);
  }

  #logAnswered(tool: string, ms: number): void {
    const log = ms >= SLOW_CALL_MS ? this.#logger.info : this.#logger.debug;
    log("Computer Use driver answered", { tool, ms });
  }

  #logUnanswered(tool: string, ms: number): void {
    this.#logger.info("Computer Use driver did not answer", { tool, ms });
  }
}
