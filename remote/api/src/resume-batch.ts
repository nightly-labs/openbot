import { Deferred, type Duration, Effect, Result, type Scope, Semaphore } from "effect";
import type { RemoteTicketClaims } from "./protocol";

const RESUME_BATCH_LIMIT = 100;

type ResumeBatchAnswer = { readonly valid: readonly boolean[] } | "unsupported";

interface ResumeBatchOptions<E> {
  readonly scope: Scope.Scope;
  readonly wait: Duration.Input;
  readonly concurrency: number;
  readonly batch: (claims: readonly RemoteTicketClaims[]) => Effect.Effect<ResumeBatchAnswer, E>;
  readonly single: (claims: RemoteTicketClaims) => Effect.Effect<boolean, E>;
}

interface PendingCheck<E> {
  readonly key: string;
  readonly claims: RemoteTicketClaims;
  readonly answer: Deferred.Deferred<boolean, E>;
}

function claimsKey(claims: RemoteTicketClaims): string {
  return JSON.stringify([
    claims.sessionId,
    claims.hostId,
    claims.userId,
    claims.membershipId,
    claims.role,
    claims.authEpoch,
    claims.sessionExpiresAt,
  ]);
}

export function makeResumeBatcher<E>(options: ResumeBatchOptions<E>) {
  const permits = Semaphore.makeUnsafe(options.concurrency);
  let pending: PendingCheck<E>[] = [];
  let flushScheduled = false;

  const answerEach = (
    checks: readonly PendingCheck<E>[],
    answer: (check: PendingCheck<E>) => Effect.Effect<boolean, E>,
  ) =>
    Effect.forEach(checks, (check) => Effect.sync(() => Deferred.doneUnsafe(check.answer, answer(check))), {
      discard: true,
    });

  const checkOneByOne = (claimsByKey: ReadonlyMap<string, RemoteTicketClaims>, checks: readonly PendingCheck<E>[]) =>
    Effect.forEach(
      claimsByKey,
      ([key, claims]) =>
        options.single(claims).pipe(
          Effect.result,
          Effect.flatMap((result) =>
            answerEach(
              checks.filter((check) => check.key === key),
              () => (Result.isSuccess(result) ? Effect.succeed(result.success) : Effect.fail(result.failure)),
            ),
          ),
        ),
      { concurrency: "unbounded", discard: true },
    );

  const send = (checks: readonly PendingCheck<E>[]) =>
    Effect.gen(function* () {
      const claimsByKey = new Map(checks.map((check) => [check.key, check.claims]));
      const keys = [...claimsByKey.keys()];
      const result = yield* Effect.result(options.batch([...claimsByKey.values()]));
      if (Result.isFailure(result)) return yield* answerEach(checks, () => Effect.fail(result.failure));
      const answer = result.success;
      if (answer === "unsupported") return yield* checkOneByOne(claimsByKey, checks);
      const valid = new Map(keys.map((key, index) => [key, answer.valid[index] === true]));
      yield* answerEach(checks, (check) => Effect.succeed(valid.get(check.key) === true));
    }).pipe(permits.withPermit, Effect.uninterruptible);

  const startBatches = Effect.suspend(() => {
    const taken = pending;
    pending = [];
    const batches: PendingCheck<E>[][] = [];
    for (let start = 0; start < taken.length; start += RESUME_BATCH_LIMIT)
      batches.push(taken.slice(start, start + RESUME_BATCH_LIMIT));
    return Effect.forEach(batches, (batch) => Effect.forkIn(send(batch), options.scope), { discard: true });
  });

  const scheduleFlush = Effect.suspend(() => {
    if (flushScheduled) return Effect.void;
    flushScheduled = true;
    return Effect.forkIn(
      Effect.sleep(options.wait).pipe(
        Effect.andThen(
          Effect.suspend(() => {
            flushScheduled = false;
            return startBatches;
          }),
        ),
      ),
      options.scope,
    ).pipe(Effect.asVoid);
  });

  return Effect.fn("ResumeBatcher.validate")(function* (claims: RemoteTicketClaims) {
    const answer = Deferred.makeUnsafe<boolean, E>();
    pending.push({ key: claimsKey(claims), claims, answer });
    if (pending.length >= RESUME_BATCH_LIMIT) yield* startBatches;
    else yield* scheduleFlush;
    return yield* Deferred.await(answer);
  });
}
