import { readFile } from "node:fs/promises";
import { createOpenBotLogger } from "@openbot/logging";
import { Effect, Result, Schema, Semaphore } from "effect";
import { isEmptyStoredFile, parseStoredJson, setAsideDamagedFile, writeJsonFileAtomically } from "../atomic-json-file";
import { isMissingFileError } from "../file-errors";

const logger = createOpenBotLogger("memory-review");

class MemoryReviewCursorsReadFailed extends Schema.TaggedError<MemoryReviewCursorsReadFailed>()(
  "MemoryReviewCursorsReadFailed",
  { cause: Schema.Defect() },
) {}

const StoredMemoryReviewCursors = Schema.Struct({
  version: Schema.Literal(1),
  cursors: Schema.Array(
    Schema.Struct({ agentId: Schema.String, threadId: Schema.NullOr(Schema.String), cursor: Schema.String }),
  ),
});
type StoredMemoryReviewCursors = typeof StoredMemoryReviewCursors.Type;
const decodeStored = Schema.decodeUnknownSync(StoredMemoryReviewCursors);

interface Cursor {
  readonly agentId: string;
  readonly threadId: string | null;
  readonly cursor: string;
}

/**
 * Owns the file of the last message that each memory review read, by agent and side thread, so a
 * review after a restart reads only the new part of the conversation and not the latest 200
 * messages again. The cursor is an aid, not data: a missing or damaged file, or a cursor whose
 * message is gone, makes the review read the latest messages as before.
 *
 * It never imports the agent service facade.
 */
export class MemoryReviewCursors {
  readonly #path: string;
  readonly #cursors = new Map<string, Cursor>();
  readonly #writes = Semaphore.makeUnsafe(1);
  #loaded = false;

  constructor(path: string) {
    this.#path = path;
  }

  /**
   * Reads the file once. A failure is logged, and the reviews start with no cursors. The read holds
   * the write permit, so a call during the read waits for it, and no write can replace the file first.
   */
  load(): Effect.Effect<void> {
    return this.#loaded ? Effect.void : this.#writes.withPermit(this.#read());
  }

  readonly #read = Effect.fn("MemoryReviewCursors.read")(function* (this: MemoryReviewCursors) {
    if (this.#loaded) return;
    this.#loaded = true;
    const read = yield* Effect.result(
      Effect.tryPromise({
        try: () => readFile(this.#path, "utf8"),
        catch: (cause) => new MemoryReviewCursorsReadFailed({ cause }),
      }),
    );
    if (Result.isFailure(read)) {
      if (!isMissingFileError(read.failure.cause))
        logger.warn("Could not read the memory review cursors.", { error: read.failure.cause });
      return;
    }
    if (isEmptyStoredFile(read.success)) return;
    const stored = yield* Effect.result(
      Effect.try({
        try: () => parseStoredJson(this.#path, read.success, decodeStored),
        catch: (cause) => new MemoryReviewCursorsReadFailed({ cause }),
      }),
    );
    if (Result.isFailure(stored)) {
      logger.warn("The memory review cursors are damaged. The reviews read the latest messages.", {
        error: stored.failure.cause,
      });
      yield* setAsideDamagedFile(this.#path);
      return;
    }
    for (const cursor of stored.success.cursors)
      this.#cursors.set(conversationKey(cursor.agentId, cursor.threadId), cursor);
  }).bind(this);

  /** The cursor of one conversation. Call it after `load`. */
  get(agentId: string, threadId: string | null): string | null {
    return this.#cursors.get(conversationKey(agentId, threadId))?.cursor ?? null;
  }

  /**
   * Saves the cursor of one conversation, or removes it with `null`. It loads the file first, so a
   * removal before the first review also removes the saved entry.
   */
  set(agentId: string, threadId: string | null, cursor: string | null): Effect.Effect<void> {
    return this.load().pipe(
      Effect.andThen(
        Effect.suspend(() => {
          const key = conversationKey(agentId, threadId);
          if ((this.#cursors.get(key)?.cursor ?? null) === cursor) return Effect.void;
          if (cursor === null) this.#cursors.delete(key);
          else this.#cursors.set(key, { agentId, threadId, cursor });
          return this.#write();
        }),
      ),
    );
  }

  /** Removes the cursors of a deleted agent, also before the first review loaded the file. */
  forgetAgent(agentId: string): Effect.Effect<void> {
    return this.load().pipe(
      Effect.andThen(
        Effect.suspend(() => {
          let changed = false;
          for (const [key, cursor] of this.#cursors)
            if (cursor.agentId === agentId) {
              this.#cursors.delete(key);
              changed = true;
            }
          return changed ? this.#write() : Effect.void;
        }),
      ),
    );
  }

  /**
   * Writes the current map. Each write takes the latest map, so the last write in the queue wins. A
   * write that started ends, so a stop waits for it and does not leave a temporary file.
   */
  #write(): Effect.Effect<void> {
    return this.#writes
      .withPermit(
        Effect.uninterruptible(
          Effect.suspend(() => {
            const stored: StoredMemoryReviewCursors = { version: 1, cursors: [...this.#cursors.values()] };
            return writeJsonFileAtomically(this.#path, stored, { createDirectory: true });
          }),
        ),
      )
      .pipe(
        Effect.catch((failure) =>
          Effect.sync(() => logger.warn("Could not save the memory review cursors.", { error: failure.cause })),
        ),
      );
  }
}

/** The key of one reviewed conversation: the agent's own chat (`threadId` null) or one side thread. */
export function conversationKey(agentId: string, threadId: string | null): string {
  return threadId === null ? agentId : `${agentId}\u0000${threadId}`;
}
