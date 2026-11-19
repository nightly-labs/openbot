import { readFile, writeFile } from "node:fs/promises";
import { createOpenBotLogger } from "@openbot/logging";
import { Effect, Option, Result, Schema, Semaphore } from "effect";
import type { AgentClient, AgentProvider } from "../agent-client";
import { isCodexActiveWriterError, isMissingProviderSessionError } from "./thread-items";

const logger = createOpenBotLogger("codex-archive-retries");

const PendingArchivesFile = Schema.fromJsonString(Schema.Record(Schema.String, Schema.NullOr(Schema.String)));

export interface CodexArchiveRetriesOptions {
  path: () => string;
  logFailure: (provider: AgentProvider, error: unknown) => void;
}

export class CodexArchiveRetries {
  readonly #path: () => string;
  readonly #logFailure: (provider: AgentProvider, error: unknown) => void;
  readonly #writes = Semaphore.makeUnsafe(1);
  #pending: Map<string, string | null> | undefined;

  constructor(options: CodexArchiveRetriesOptions) {
    this.#path = options.path;
    this.#logFailure = options.logFailure;
  }

  readonly archive = Effect.fn("CodexArchiveRetries.archive")(function* (
    this: CodexArchiveRetries,
    client: AgentClient,
    threadId: string,
  ) {
    if (!(yield* this.#archiveHeld(client, threadId)) || !client.newestTurnId) return;
    const newest = yield* Effect.result(client.newestTurnId(threadId));
    if (Result.isFailure(newest)) return this.#logFailure(client.provider, newest.failure.cause);
    yield* this.#writes.withPermit(
      Effect.gen({ self: this }, function* () {
        const pending = yield* this.#load();
        pending.set(threadId, newest.success);
        yield* this.#save(pending);
      }),
    );
  });

  readonly retry = Effect.fn("CodexArchiveRetries.retry")(function* (this: CodexArchiveRetries, client: AgentClient) {
    if (!client.archiveThread || !client.newestTurnId) return;
    yield* this.#writes.withPermit(
      Effect.gen({ self: this }, function* () {
        const pending = yield* this.#load();
        let changed = false;
        for (const [threadId, turnId] of [...pending]) {
          if (yield* this.#stillHeld(client, threadId, turnId)) continue;
          pending.delete(threadId);
          changed = true;
        }
        if (changed) yield* this.#save(pending);
      }),
    );
  });

  readonly #stillHeld = Effect.fn("CodexArchiveRetries.stillHeld")(function* (
    this: CodexArchiveRetries,
    client: AgentClient,
    threadId: string,
    turnId: string | null,
  ) {
    if (!client.newestTurnId) return true;
    const newest = yield* Effect.result(client.newestTurnId(threadId));
    if (Result.isFailure(newest)) return !isMissingProviderSessionError(newest.failure.cause, client.provider);
    if (newest.success !== turnId) {
      logger.info("Kept a replaced Codex session that has new turns from another Codex app.");
      return false;
    }
    return yield* this.#archiveHeld(client, threadId);
  });

  readonly #archiveHeld = Effect.fn("CodexArchiveRetries.archiveHeld")(function* (
    this: CodexArchiveRetries,
    client: AgentClient,
    threadId: string,
  ) {
    if (!client.archiveThread) return false;
    const archived = yield* Effect.result(client.archiveThread(threadId));
    if (Result.isSuccess(archived)) return false;
    if (isCodexActiveWriterError(archived.failure.cause)) return true;
    this.#logFailure(client.provider, archived.failure.cause);
    return false;
  });

  readonly #load = Effect.fn("CodexArchiveRetries.load")(function* (this: CodexArchiveRetries) {
    if (this.#pending) return this.#pending;
    const text = yield* Effect.result(Effect.tryPromise(() => readFile(this.#path(), "utf8")));
    const stored = Result.isSuccess(text)
      ? Schema.decodeUnknownOption(PendingArchivesFile)(text.success)
      : Option.none<Record<string, string | null>>();
    if (Result.isSuccess(text) && Option.isNone(stored)) logger.warn("Could not read the pending Codex archives.");
    this.#pending = new Map(Object.entries(Option.getOrElse(stored, () => ({}))));
    return this.#pending;
  });

  readonly #save = Effect.fn("CodexArchiveRetries.save")(function* (
    this: CodexArchiveRetries,
    pending: ReadonlyMap<string, string | null>,
  ) {
    const text = JSON.stringify(Object.fromEntries(pending));
    yield* Effect.tryPromise(() => writeFile(this.#path(), text, { mode: 0o600 })).pipe(
      Effect.catch((error) => Effect.sync(() => logger.warn("Could not save the pending Codex archives.", { error }))),
    );
  });
}
