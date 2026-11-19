import { connect, type Socket } from "node:net";
import { type DynamicRecord, isDynamicRecord } from "@openbot/contracts/runtime-values";
import { Effect } from "effect";
import { CuaDriverFailure } from "./cua-driver-effects";

const REQUEST_TIMEOUT_MS = 2_000;
const MAX_RESPONSE_BYTES = 4_194_304;
const SESSION_ID = "openbot-highlight";
export const HIGHLIGHT_OWNER_SHORT_ID = SESSION_ID.slice(-8);

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
}

export class CuaDriverDaemonClient {
  readonly #socketPath: () => string | null;
  #socket: Socket | null = null;
  #pending: PendingRequest[] = [];
  #buffer = "";

  constructor(socketPath: () => string | null) {
    this.#socketPath = socketPath;
  }

  listWindows(): Effect.Effect<unknown, CuaDriverFailure> {
    return this.#request({
      method: "call",
      name: "list_windows",
      args: { on_screen_only: true },
      session_id: SESSION_ID,
      client_kind: "cli",
    }).pipe(Effect.map((result) => (isDynamicRecord(result) ? result.structuredContent : null)));
  }

  sessions(): Effect.Effect<unknown, CuaDriverFailure> {
    return this.#request({ method: "sessions_list", client_kind: "cli" });
  }

  close(): Effect.Effect<void, CuaDriverFailure> {
    return Effect.gen({ self: this }, function* () {
      if (this.#socket)
        yield* this.#request({ method: "session_end", session_id: SESSION_ID, client_kind: "cli" }).pipe(
          Effect.catch(() => Effect.void),
        );
    }).pipe(
      Effect.ensuring(Effect.sync(() => this.#drop(new Error("The Computer Use driver connection was closed.")))),
    );
  }

  #request = Effect.fn("CuaDriverDaemon.request")(function* (this: CuaDriverDaemonClient, payload: DaemonReadRequest) {
    const socket = yield* this.#connection();
    return yield* Effect.callback<unknown, CuaDriverFailure>((resume) => {
      const pending: PendingRequest = {
        resolve: (result) => resume(Effect.succeed(result)),
        reject: (cause) => resume(Effect.fail(new CuaDriverFailure({ cause }))),
      };
      this.#pending.push(pending);
      try {
        socket.write(`${JSON.stringify(payload)}\n`);
      } catch (error) {
        this.#drop(error instanceof Error ? error : new Error(String(error)));
      }
      return Effect.sync(() => {
        if (this.#pending.includes(pending)) this.#drop(new Error("The Computer Use driver did not answer in time."));
      });
    }).pipe(
      Effect.timeoutOrElse({
        duration: REQUEST_TIMEOUT_MS,
        orElse: () =>
          Effect.fail(new CuaDriverFailure({ cause: new Error("The Computer Use driver did not answer in time.") })),
      }),
    );
  });

  #connection = Effect.fn("CuaDriverDaemon.connect")(function* (this: CuaDriverDaemonClient) {
    const existing = this.#socket;
    if (existing && !existing.destroyed) return existing;
    const path = this.#socketPath();
    if (!path) return yield* new CuaDriverFailure({ cause: new Error("The Computer Use driver is not running.") });
    return yield* Effect.callback<Socket, CuaDriverFailure>((resume) => {
      const opening = connect(path);
      let connected = false;
      const fail = (cause: Error) => resume(Effect.fail(new CuaDriverFailure({ cause })));
      const ready = () => {
        connected = true;
        opening.removeListener("error", fail);
        this.#socket = opening;
        this.#buffer = "";
        opening.setEncoding("utf8");
        opening.on("data", (chunk: string) => this.#read(chunk));
        opening.on("error", (error) => this.#drop(error));
        opening.on("close", () => this.#drop(new Error("The Computer Use driver closed the connection.")));
        resume(Effect.succeed(opening));
      };
      opening.once("error", fail);
      opening.once("connect", ready);
      return Effect.sync(() => {
        opening.removeListener("connect", ready);
        opening.removeListener("error", fail);
        if (!connected) opening.destroy();
      });
    });
  });

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

  #drop(error: Error): void {
    const socket = this.#socket;
    this.#socket = null;
    this.#buffer = "";
    const pending = this.#pending;
    this.#pending = [];
    for (const request of pending) {
      request.reject(error);
    }
    if (socket) {
      socket.removeAllListeners();
      socket.destroy();
    }
  }
}
