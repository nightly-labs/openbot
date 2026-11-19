import { createOpenBotLogger } from "@openbot/logging";
import { Effect, Schema, Semaphore } from "effect";
import { writeJsonFileAtomically } from "../atomic-json-file";
import { readVersionedJsonFile, type VersionedJsonFormat } from "../versioned-json-store";

const logger = createOpenBotLogger("memory-review");

const StoredMemoryReviewCursors = Schema.Struct({
  version: Schema.Literal(1),
  cursors: Schema.Array(
    Schema.Struct({ agentId: Schema.String, threadId: Schema.NullOr(Schema.String), cursor: Schema.String }),
  ),
});
type StoredMemoryReviewCursors = typeof StoredMemoryReviewCursors.Type;
const MEMORY_REVIEW_CURSORS_FORMAT: VersionedJsonFormat<StoredMemoryReviewCursors> = {
  current: 1,
  releases: { 1: Schema.decodeUnknownSync(StoredMemoryReviewCursors) },
};

interface Cursor {
  readonly agentId: string;
  readonly threadId: string | null;
  readonly cursor: string;
}

export class MemoryReviewCursors {
  readonly #path: string;
  #writePath: string;
  readonly #cursors = new Map<string, Cursor>();
  readonly #writes = Semaphore.makeUnsafe(1);
  #loaded = false;

  constructor(path: string) {
    this.#path = path;
    this.#writePath = path;
  }

  load(): Effect.Effect<void> {
    return this.#loaded ? Effect.void : this.#writes.withPermit(this.#read());
  }

  readonly #read = Effect.fn("MemoryReviewCursors.read")(function* (this: MemoryReviewCursors) {
    if (this.#loaded) return;
    this.#loaded = true;
    const loaded = yield* readVersionedJsonFile(this.#path, MEMORY_REVIEW_CURSORS_FORMAT);
    this.#writePath = loaded.writePath;
    if (loaded.state === "damaged")
      logger.warn("The memory review cursors are damaged. The reviews read the latest messages.");
    else if (loaded.state === "unreadable") logger.warn("Could not read the memory review cursors.");
    else if (loaded.state === "kept")
      logger.warn("A newer version wrote the memory review cursors file. It stays unchanged.");
    for (const cursor of loaded.value?.cursors ?? [])
      this.#cursors.set(conversationKey(cursor.agentId, cursor.threadId), cursor);
  }).bind(this);

  get(agentId: string, threadId: string | null): string | null {
    return this.#cursors.get(conversationKey(agentId, threadId))?.cursor ?? null;
  }

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

  #write(): Effect.Effect<void> {
    return this.#writes
      .withPermit(
        Effect.uninterruptible(
          Effect.suspend(() => {
            const stored: StoredMemoryReviewCursors = { version: 1, cursors: [...this.#cursors.values()] };
            return writeJsonFileAtomically(this.#writePath, stored, { createDirectory: true });
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

export function conversationKey(agentId: string, threadId: string | null): string {
  return threadId === null ? agentId : `${agentId}\u0000${threadId}`;
}
