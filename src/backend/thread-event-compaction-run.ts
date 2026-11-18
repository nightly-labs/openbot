import { Duration, Effect, Schema } from "effect";
import type { ThreadEventCompactionBatch } from "./database/thread-event-compaction";

/** The bound of one batch is in the controller; this pause lets other work run between them. */
const COMPACTION_PAUSE = Duration.millis(5);

/** A batch failed outside the transaction of a thread, for example when the database closed. */
export class ThreadEventCompactionFailed extends Schema.TaggedError<ThreadEventCompactionFailed>()(
  "ThreadEventCompactionFailed",
  { cause: Schema.Defect() },
) {}

export interface ThreadEventCompactionResult {
  /** The threads that this run finished. */
  threads: number;
  events: number;
  rewritten: number;
  bytesBefore: number;
  bytesAfter: number;
  batches: number;
  /** The threads that wait for the next start, by the name of their error. Names only, no text. */
  failedThreads: Record<string, number>;
}

/**
 * Removes the message copies that a replay does not need from the old thread events of a database,
 * one small transaction at a time (`ThreadEventCompaction`). The writes of this release keep no
 * copies, so after the first complete run each start only finds the new threads done.
 */
export function compactThreadEvents(
  database: { compactThreadEvents(): ThreadEventCompactionBatch },
  pause: Duration.Duration = COMPACTION_PAUSE,
): Effect.Effect<ThreadEventCompactionResult, ThreadEventCompactionFailed> {
  return Effect.gen(function* () {
    const result: ThreadEventCompactionResult = {
      threads: 0,
      events: 0,
      rewritten: 0,
      bytesBefore: 0,
      bytesAfter: 0,
      batches: 0,
      failedThreads: {},
    };
    for (;;) {
      const batch = yield* Effect.try({
        try: () => database.compactThreadEvents(),
        catch: (cause) => new ThreadEventCompactionFailed({ cause }),
      });
      if (batch.done) return result;
      result.batches += 1;
      result.events += batch.events;
      result.rewritten += batch.rewritten;
      result.bytesBefore += batch.bytesBefore;
      result.bytesAfter += batch.bytesAfter;
      if (batch.completedThread) result.threads += 1;
      if (batch.failedThread)
        result.failedThreads[batch.failedThread] = (result.failedThreads[batch.failedThread] ?? 0) + 1;
      yield* Effect.sleep(pause);
    }
  });
}
