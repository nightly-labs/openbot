import { Clock, Duration, Effect, Schema } from "effect";
import type { ThreadEventCompactionBatch } from "./database/thread-event-compaction";

const COMPACTION_PAUSE = Duration.millis(5);
const REST_PER_WORK = 9;

export class ThreadEventCompactionFailed extends Schema.TaggedError<ThreadEventCompactionFailed>()(
  "ThreadEventCompactionFailed",
  { cause: Schema.Defect() },
) {}

export interface ThreadEventCompactionResult {
  threads: number;
  events: number;
  rewritten: number;
  deleted: number;
  bytesBefore: number;
  bytesAfter: number;
  batches: number;
  failedThreads: Record<string, number>;
}

export function compactThreadEvents(
  database: { compactThreadEvents(): ThreadEventCompactionBatch },
  pause: Duration.Duration = COMPACTION_PAUSE,
): Effect.Effect<ThreadEventCompactionResult, ThreadEventCompactionFailed> {
  return Effect.gen(function* () {
    const result: ThreadEventCompactionResult = {
      threads: 0,
      events: 0,
      rewritten: 0,
      deleted: 0,
      bytesBefore: 0,
      bytesAfter: 0,
      batches: 0,
      failedThreads: {},
    };
    for (;;) {
      const started = yield* Clock.currentTimeMillis;
      const batch = yield* Effect.try({
        try: () => database.compactThreadEvents(),
        catch: (cause) => new ThreadEventCompactionFailed({ cause }),
      });
      if (batch.done) return result;
      result.batches += 1;
      result.events += batch.events;
      result.rewritten += batch.rewritten;
      result.deleted += batch.deleted;
      result.bytesBefore += batch.bytesBefore;
      result.bytesAfter += batch.bytesAfter;
      if (batch.completedThread) result.threads += 1;
      if (batch.failedThread)
        result.failedThreads[batch.failedThread] = (result.failedThreads[batch.failedThread] ?? 0) + 1;
      const worked = (yield* Clock.currentTimeMillis) - started;
      yield* Effect.sleep(Duration.max(pause, Duration.millis(worked * REST_PER_WORK)));
    }
  });
}
