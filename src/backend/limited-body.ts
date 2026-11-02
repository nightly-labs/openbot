import { Effect } from "effect";

/** Why a body was not read: it is larger than the limit, or the connection failed while reading. */
export type LimitedBodyFailure = "too-large" | "unreadable";

/**
 * A response body of at most `limit` bytes. A declared `content-length` above the limit fails
 * before any byte is read; a body without one is counted as it arrives and stopped at the limit.
 * The body is cancelled and released on success, failure and interruption.
 */
export function readLimitedBody<E>(
  response: Response,
  limit: number,
  failure: (reason: LimitedBodyFailure) => E,
): Effect.Effect<Buffer, E> {
  const declared = Number(response.headers.get("content-length"));
  if (Number.isFinite(declared) && declared > limit) return Effect.fail(failure("too-large"));
  const reader = response.body?.getReader();
  if (!reader) return Effect.succeed(Buffer.alloc(0));
  return Effect.acquireUseRelease(
    Effect.succeed(reader),
    (body) =>
      Effect.gen(function* () {
        const chunks: Uint8Array[] = [];
        let size = 0;
        for (;;) {
          const chunk = yield* Effect.tryPromise({ try: () => body.read(), catch: () => failure("unreadable") });
          if (chunk.done) break;
          size += chunk.value.byteLength;
          if (size > limit) return yield* Effect.fail(failure("too-large"));
          chunks.push(chunk.value);
        }
        return Buffer.concat(chunks);
      }),
    (body) =>
      Effect.promise(() => body.cancel().catch(() => undefined)).pipe(
        Effect.ensuring(Effect.sync(() => body.releaseLock())),
      ),
  );
}
