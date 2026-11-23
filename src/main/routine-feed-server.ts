import { randomBytes, timingSafeEqual } from "node:crypto";
import { rm } from "node:fs/promises";
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import type { RoutineFeed } from "@openbot/contracts/ipc";
import { isString } from "@openbot/contracts/runtime-values";
import { createOpenBotLogger, registerSecretValue } from "@openbot/logging";
import { Effect, Result, Schema, Semaphore } from "effect";
import { z } from "zod";
import { runCauseEffect } from "../backend/effect-boundary";
import { readPreferenceFile, writePreferenceFile } from "./preference-file";

const logger = createOpenBotLogger("routine-feed");

const FEED_PATH = /^\/routines\/([A-Za-z0-9_-]+)\.ics$/;
const storedFeedSchema = z.object({
  version: z.literal(1),
  token: z.string().min(1),
  port: z.number().int().min(1).max(65_535),
});

export class RoutineFeedFailed extends Schema.TaggedError<RoutineFeedFailed>()("RoutineFeedFailed", {
  cause: Schema.Defect(),
}) {}

export class RoutineFeedAgentNotFound extends Schema.TaggedError<RoutineFeedAgentNotFound>()(
  "RoutineFeedAgentNotFound",
  {},
) {}

function feedIO<A>(operation: () => Promise<A>): Effect.Effect<A, RoutineFeedFailed> {
  return Effect.tryPromise({ try: operation, catch: (cause) => new RoutineFeedFailed({ cause }) });
}

interface SecretCipher {
  encrypt: (value: string) => Buffer;
  decrypt: (value: Buffer) => string;
}

export interface RoutineFeedServerOptions {
  path: string;
  cipher: SecretCipher;
  document: (agentId: string | null) => Effect.Effect<string, RoutineFeedAgentNotFound | RoutineFeedFailed>;
}

export class RoutineFeedServer {
  readonly #options: RoutineFeedServerOptions;
  #server: Server | null = null;
  #port = 0;
  #token: Buffer = Buffer.alloc(0);
  readonly #lock = Semaphore.makeUnsafe(1);

  constructor(options: RoutineFeedServerOptions) {
    this.#options = options;
  }

  readonly start = Effect.fn("RoutineFeedServer.start")(function* (this: RoutineFeedServer) {
    yield* this.#lock.withPermit(
      Effect.gen({ self: this }, function* () {
        const stored = yield* Effect.result(this.#read());
        if (Result.isFailure(stored)) {
          logger.warn("The routine feed could not be read. It stays off.", stored.failure.cause);
          return;
        }
        if (!stored.success) return;
        const { token, port } = stored.success;
        const opened = yield* Effect.result(this.#open(token, port));
        if (Result.isFailure(opened)) {
          logger.warn("The routine feed could not open.", opened.failure.cause);
          return;
        }
        if (this.#port === port) return;
        const saved = yield* Effect.result(this.#write(token, this.#port));
        if (Result.isFailure(saved)) logger.warn("The new routine feed port could not be saved.", saved.failure.cause);
      }),
    );
  }).bind(this);

  readonly status = Effect.fn("RoutineFeedServer.status")(function* (this: RoutineFeedServer) {
    return yield* this.#lock.withPermit(Effect.sync(() => this.#status()));
  }).bind(this);

  readonly create = Effect.fn("RoutineFeedServer.create")(function* (this: RoutineFeedServer) {
    return yield* this.#lock.withPermit(
      Effect.gen({ self: this }, function* () {
        const token = randomBytes(32).toString("base64url");
        const stored = yield* Effect.result(this.#read());
        const port = this.#server ? this.#port : Result.isSuccess(stored) ? (stored.success?.port ?? 0) : 0;
        const previous = this.#server ? this.#token : null;
        yield* this.#open(token, port);
        yield* this.#write(token, this.#port).pipe(
          Effect.tapError(() =>
            previous
              ? Effect.sync(() => {
                  this.#token = previous;
                })
              : this.#close(),
          ),
        );
        logger.info("The routine feed has a new URL.");
        return this.#status();
      }).pipe(Effect.uninterruptible),
    );
  }).bind(this);

  readonly remove = Effect.fn("RoutineFeedServer.remove")(function* (this: RoutineFeedServer) {
    return yield* this.#lock.withPermit(
      Effect.gen({ self: this }, function* () {
        const path = this.#options.path;
        yield* feedIO(() => rm(path, { force: true }));
        yield* this.#close();
        logger.info("The routine feed is off.");
        return this.#status();
      }).pipe(Effect.uninterruptible),
    );
  }).bind(this);

  readonly stop = Effect.fn("RoutineFeedServer.stop")(function* (this: RoutineFeedServer) {
    yield* this.#lock.withPermit(Effect.suspend(() => this.#close()));
  }).bind(this);

  #status(): RoutineFeed {
    if (!this.#server || this.#token.length === 0) return { url: null };
    return { url: `http://127.0.0.1:${this.#port}/routines/${this.#token.toString()}.ics` };
  }

  #read(): Effect.Effect<{ token: string; port: number } | null, RoutineFeedFailed> {
    const { path, cipher } = this.#options;
    return readPreferenceFile(path, (input) => {
      const stored = storedFeedSchema.parse(input);
      return { token: cipher.decrypt(Buffer.from(stored.token, "base64")), port: stored.port };
    }).pipe(
      Effect.catch((failure) => {
        const error = failure.cause;
        if (error instanceof Error && "code" in error && error.code === "ENOENT") return Effect.succeed(null);
        return Effect.fail(new RoutineFeedFailed({ cause: error }));
      }),
    );
  }

  #write(token: string, port: number): Effect.Effect<void, RoutineFeedFailed> {
    const { path, cipher } = this.#options;
    return Effect.try({
      try: () => cipher.encrypt(token).toString("base64"),
      catch: (cause) => new RoutineFeedFailed({ cause }),
    }).pipe(
      Effect.flatMap((encrypted) =>
        writePreferenceFile(path, { version: 1, token: encrypted, port }, { createDirectory: true }),
      ),
      Effect.mapError((error) => new RoutineFeedFailed({ cause: error.cause })),
    );
  }

  #open(token: string, port: number): Effect.Effect<void, RoutineFeedFailed> {
    return Effect.gen({ self: this }, function* () {
      registerSecretValue(token);
      if (!this.#server) {
        const server = createServer((request, response) => void this.#handle(request, response));
        const bound = yield* Effect.result(listen(server, port));
        if (Result.isFailure(bound) && port !== 0) {
          logger.warn(`Port ${port} of the routine feed is not free. The feed gets a new URL.`);
          yield* listen(server, 0);
        } else if (Result.isFailure(bound)) {
          return yield* bound.failure;
        }
        const address = server.address();
        if (!address || isString(address)) {
          server.close();
          return yield* new RoutineFeedFailed({ cause: new Error("Unable to bind the routine feed.") });
        }
        this.#server = server;
        this.#port = address.port;
      }
      this.#token = Buffer.from(token);
    });
  }

  #close(): Effect.Effect<void> {
    const server = this.#server;
    this.#server = null;
    this.#token = Buffer.alloc(0);
    if (!server) return Effect.void;
    server.closeAllConnections();
    return Effect.callback<void>((resume) => {
      server.close(() => resume(Effect.void));
    });
  }

  async #handle(request: IncomingMessage, response: ServerResponse): Promise<void> {
    try {
      const host = request.headers.host;
      if ((host !== `127.0.0.1:${this.#port}` && host !== `localhost:${this.#port}`) || request.headers.origin) {
        return sendText(response, 403, "Forbidden");
      }
      if (request.method !== "GET" && request.method !== "HEAD") return sendText(response, 405, "Method not allowed");
      const url = new URL(request.url ?? "/", "http://127.0.0.1");
      const token = FEED_PATH.exec(url.pathname)?.[1];
      if (!token || !this.#authorized(token)) return sendText(response, 404, "Not found");
      const result = await runCauseEffect(Effect.result(this.#options.document(url.searchParams.get("agent"))));
      if (Result.isFailure(result)) {
        if (result.failure._tag === "RoutineFeedAgentNotFound") return sendText(response, 404, "Not found");
        throw result.failure.cause;
      }
      const body = Buffer.from(result.success);
      response.writeHead(200, {
        "content-type": "text/calendar; charset=utf-8",
        "content-length": body.length,
        "cache-control": "no-store",
      });
      response.end(request.method === "HEAD" ? undefined : body);
    } catch (error) {
      logger.warn("A routine feed request failed.", error);
      if (!response.headersSent) sendText(response, 500, "Internal error");
    }
  }

  #authorized(candidate: string): boolean {
    const value = Buffer.from(candidate);
    return this.#token.length > 0 && value.length === this.#token.length && timingSafeEqual(value, this.#token);
  }
}

function listen(server: Server, port: number): Effect.Effect<void, RoutineFeedFailed> {
  return feedIO(
    () =>
      new Promise<void>((resolve, reject) => {
        server.once("error", reject);
        server.listen(port, "127.0.0.1", () => {
          server.off("error", reject);
          resolve();
        });
      }),
  );
}

function sendText(response: ServerResponse, status: number, body: string): void {
  response.writeHead(status, { "content-type": "text/plain; charset=utf-8" });
  response.end(body);
}
