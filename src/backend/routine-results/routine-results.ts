/**
 * Routine results: an agent routine's answer sent on to a messaging place outside OpenBot.
 *
 * The routine's run is not changed: it succeeds when its agent answers, and the delivery of that answer
 * has a status of its own. When a run of a routine with a destination succeeds, the sweep keeps its
 * answer as a delivery and posts it. A connection that does not run now gets more attempts for a day.
 * A post that fails on its way is not sent again by itself: a long answer goes in more than one post,
 * so a part of it can be in the place already. The user can send any ended delivery again.
 *
 * Nothing here listens to the provider. The runtime sweeps whenever the agent service says a turn, a
 * queue or a routine changed, at startup, and when the next attempt is due. Sweeps run one at a time;
 * a request during a sweep runs one more after it.
 *
 * A destination only applies to the runs that end after it was set, so choosing a place never sends
 * the answers of earlier runs.
 */

import type {
  AgentEvent,
  MessagingPlatform,
  ResendRoutineResultInput,
  RoutineResultConnectionOption,
  RoutineResultDelivery,
  RoutineResultDestination,
  RoutineResultRoutineInput,
  SetRoutineResultDestinationInput,
} from "@openbot/contracts/ipc";
import { sourceText } from "@openbot/i18n/source";
import { createOpenBotLogger } from "@openbot/logging";
import { Cause, Context, Effect, Exit, Fiber, Layer, ManagedRuntime, Schema, Scope, Semaphore } from "effect";
import { isNoUpdateAnswer } from "../agent/routine-quiet-runs";
import type { MessagingPostFailure } from "../messaging/messaging-threads";
import type { RoutineResultOutgoing, RoutineResultStore } from "./routine-result-store";

const logger = createOpenBotLogger("routine-results");

/** How far back a sweep looks for a run whose answer has no delivery yet. */
const SWEEP_WINDOW_MS = 7 * 24 * 60 * 60 * 1000;
const FIRST_RETRY_MS = 60 * 1000;
const LONGEST_RETRY_MS = 15 * 60 * 1000;

class RoutineResultFailed extends Schema.TaggedError<RoutineResultFailed>()("RoutineResultFailed", {
  cause: Schema.Defect(),
}) {}

/** A refusal the user reads: the text is already a sentence for them. */
export class RoutineResultError extends Error {}

export interface RoutineResultsDependencies {
  store: RoutineResultStore;
  /** The turn that answered a run's delivery, or null when the delivery is gone. */
  delivery(deliveryId: string): { turnId: string | null } | null;
  /** The answer an agent gave in one turn, or null when it gave none. */
  turnAnswer(agentId: string, turnId: string): string | null;
  /** An enabled messaging connection of this host, or null when it is off or removed. */
  connection(connectionId: string): { platform: MessagingPlatform; name: string } | null;
  options(): Effect.Effect<RoutineResultConnectionOption[]>;
  post(
    connectionId: string,
    placeId: string,
    markdown: string,
  ): Effect.Effect<{ posted: true } | { failure: MessagingPostFailure }>;
  /** The agents whose routine deliveries changed. */
  changed(agentIds: string[]): void;
  now?: () => Date;
}

interface RoutineResultsShape {
  options(): Effect.Effect<RoutineResultConnectionOption[]>;
  destination(input: RoutineResultRoutineInput): Effect.Effect<RoutineResultDestination | null, RoutineResultFailed>;
  setDestination(
    input: SetRoutineResultDestinationInput,
  ): Effect.Effect<RoutineResultDestination | null, RoutineResultFailed>;
  deliveries(input: RoutineResultRoutineInput): Effect.Effect<RoutineResultDelivery[], RoutineResultFailed>;
  resend(input: ResendRoutineResultInput): Effect.Effect<void, RoutineResultFailed>;
  /** At startup: a post that a stop cut off may be in its place in part. Then starts a sweep and returns. */
  recover(): Effect.Effect<void>;
  /** Keeps each new answer and posts each one that is due. */
  sweep(): Effect.Effect<void>;
  /** Asks for a sweep when an agent event may have ended a run. Returns at once. */
  notice(event: AgentEvent): Effect.Effect<void>;
}

class RoutineResults extends Context.Service<RoutineResults, RoutineResultsShape>()("openbot/backend/RoutineResults") {
  static layer(dependencies: RoutineResultsDependencies) {
    return Layer.effect(
      RoutineResults,
      Effect.gen(function* () {
        const scope = yield* Scope.Scope;
        const lock = yield* Semaphore.make(1);
        const { store } = dependencies;
        const now = () => (dependencies.now ?? (() => new Date()))();
        /** A sweep running, and whether another was asked for while it ran. */
        let sweeping = false;
        let again = false;
        /** The wait for the next pending attempt. */
        let timer: Fiber.Fiber<void> | null = null;

        const attempt = <A>(work: () => A) =>
          Effect.try({ try: work, catch: (cause) => new RoutineResultFailed({ cause }) });

        const ownRoutine = (input: RoutineResultRoutineInput) => {
          if (store.routineOwner(input.routineId) !== input.agentId)
            throw new RoutineResultError(sourceText("error.backend.routineGone"));
        };

        const destination = Effect.fn("RoutineResults.destination")(function* (input: RoutineResultRoutineInput) {
          return yield* attempt(() => {
            ownRoutine(input);
            return store.destination(input.routineId);
          });
        });

        const setDestination = Effect.fn("RoutineResults.setDestination")(function* (
          input: SetRoutineResultDestinationInput,
        ) {
          const saved = yield* attempt(() => {
            ownRoutine(input);
            const chosen = input.destination;
            if (!chosen) return store.setDestination(input.routineId, null, now().toISOString());
            const connection = dependencies.connection(chosen.connectionId);
            if (!connection) throw new RoutineResultError(sourceText("error.backend.routineResultConnectionOff"));
            return store.setDestination(
              input.routineId,
              {
                connectionId: chosen.connectionId,
                platform: connection.platform,
                connectionName: connection.name,
                placeId: chosen.placeId,
                placeName: chosen.placeName,
              },
              now().toISOString(),
            );
          });
          dependencies.changed([input.agentId]);
          return saved;
        });

        const deliveries = Effect.fn("RoutineResults.deliveries")(function* (input: RoutineResultRoutineInput) {
          return yield* attempt(() => {
            ownRoutine(input);
            return store.deliveries(input.routineId);
          });
        });

        const resend = Effect.fn("RoutineResults.resend")(function* (input: ResendRoutineResultInput) {
          yield* attempt(() => {
            if (store.deliveryOwner(input.runId) !== input.agentId)
              throw new RoutineResultError(sourceText("error.backend.routineResultNoDelivery"));
            // A delivery that waits or is on its way already keeps going; there is nothing to restart.
            store.resend(input.runId, now().toISOString());
          });
          dependencies.changed([input.agentId]);
          yield* Effect.forkIn(sweep(), scope);
        });

        /** Keeps the answer of each run that ended since the last sweep. Answers the agents it touched. */
        const recordAnswers = (since: string, at: string): Set<string> => {
          const changed = new Set<string>();
          for (const run of store.runsWithoutDelivery(since)) {
            const delivery = run.deliveryId ? dependencies.delivery(run.deliveryId) : null;
            const output = delivery?.turnId ? dependencies.turnAnswer(run.agentId, delivery.turnId) : null;
            // A Test run keeps the no-update marker in its chat; the place gets nothing for it.
            const answer = output && !isNoUpdateAnswer(output) ? output : null;
            store.createDelivery(run, answer ? resultText(run.routineName, answer) : null, at);
            if (answer) changed.add(run.agentId);
          }
          return changed;
        };

        /** Posts one delivery and records what became of it. */
        const send = Effect.fn("RoutineResults.send")(function* (item: RoutineResultOutgoing) {
          const startedAt = now();
          if (item.expiresAt <= startedAt.toISOString()) {
            store.end(item.runId, "failed", "expired", startedAt.toISOString());
            return;
          }
          if (!store.claim(item.runId, startedAt.toISOString())) return;
          const result = yield* dependencies
            .post(item.destination.connectionId, item.destination.placeId, item.text)
            .pipe(
              // A stop or a defect during the post can leave it in part: the row says so, and does not stay `sending`.
              Effect.onExit((exit) =>
                Exit.isSuccess(exit)
                  ? Effect.void
                  : Effect.sync(() =>
                      store.end(
                        item.runId,
                        "uncertain",
                        Cause.hasInterruptsOnly(exit.cause) ? "restart" : "send-failed",
                        now().toISOString(),
                      ),
                    ),
              ),
            );
          const at = now();
          if ("posted" in result) {
            store.markSent(item.runId, at.toISOString());
            return;
          }
          logger.warn("A routine result was not posted.", { runId: item.runId, failure: result.failure });
          switch (result.failure) {
            case "not-running": {
              const attempts = item.attempts + 1;
              const next = new Date(at.getTime() + retryDelay(attempts)).toISOString();
              if (next >= item.expiresAt) store.end(item.runId, "failed", "expired", at.toISOString());
              else store.retryAt(item.runId, next, at.toISOString());
              return;
            }
            case "gone":
              store.end(item.runId, "failed", "connection-gone", at.toISOString());
              return;
            case "refused":
              store.end(item.runId, "failed", "refused", at.toISOString());
              return;
            case "unknown":
              store.end(item.runId, "uncertain", "send-failed", at.toISOString());
              return;
          }
        });

        /**
         * Starts a wait for the next pending attempt, in place of the one before. The new wait is set before
         * the old one stops, so a second call during the stop replaces it too. `shortest` keeps a sweep that
         * failed from starting again at once.
         */
        const schedule = Effect.fn("RoutineResults.schedule")(function* (shortest: number) {
          const previous = timer;
          const next = store.nextAttemptAt();
          const delay = next ? Math.max(shortest, Date.parse(next) - now().getTime()) : null;
          // The wait lets go of itself before it sweeps, so the sweep's own `schedule` does not stop it.
          timer =
            delay === null
              ? null
              : yield* Effect.forkIn(
                  Effect.sleep(delay).pipe(
                    Effect.andThen(
                      Effect.sync(() => {
                        timer = null;
                      }),
                    ),
                    Effect.andThen(() => sweep()),
                  ),
                  scope,
                );
          if (previous) yield* Fiber.interrupt(previous);
        });

        const sweepOnce = Effect.fn("RoutineResults.sweepOnce")(function* () {
          const at = now();
          const changed = recordAnswers(new Date(at.getTime() - SWEEP_WINDOW_MS).toISOString(), at.toISOString());
          for (const item of store.due(at.toISOString())) {
            yield* send(item);
            changed.add(item.agentId);
          }
          if (changed.size > 0) dependencies.changed([...changed]);
        });

        const sweep = (): Effect.Effect<void> =>
          Effect.gen(function* () {
            if (sweeping) {
              again = true;
              return;
            }
            sweeping = true;
            let failed = false;
            try {
              do {
                again = false;
                yield* lock.withPermit(sweepOnce()).pipe(
                  Effect.catchCause((cause) =>
                    Effect.sync(() => {
                      failed = true;
                      logger.warn("A routine result sweep failed.", { cause: String(cause) });
                    }),
                  ),
                );
              } while (again);
            } finally {
              sweeping = false;
            }
            yield* schedule(failed ? FIRST_RETRY_MS : 0).pipe(
              Effect.catchCause((cause) =>
                Effect.sync(() => logger.warn("A routine result wait did not start.", { cause: String(cause) })),
              ),
            );
          }).pipe(Effect.withSpan("RoutineResults.sweep"));

        const recover = Effect.fn("RoutineResults.recover")(function* () {
          // Under the lock: a sweep that an early event started can have a post of its own on its way.
          const touched = yield* lock.withPermit(attempt(() => store.interruptSending(now().toISOString()))).pipe(
            Effect.catchCause((cause) =>
              Effect.sync(() => {
                logger.warn("Interrupted routine results were not marked.", { cause: String(cause) });
                return [];
              }),
            ),
          );
          if (touched.length > 0) dependencies.changed(touched);
          // Forked: startup does not wait for the posts, and `close` stops them.
          yield* Effect.forkIn(sweep(), scope);
        });

        const notice = Effect.fn("RoutineResults.notice")(function* (event: AgentEvent) {
          if (event.type !== "turn-completed" && event.type !== "queue-changed" && event.type !== "routines-changed")
            return;
          yield* Effect.forkIn(sweep(), scope);
        });

        return RoutineResults.of({
          options: () => dependencies.options(),
          destination,
          setDestination,
          deliveries,
          resend,
          recover,
          sweep,
          notice,
        });
      }),
    );
  }
}

export interface RoutineResultsHandle extends RoutineResultsShape {
  close(): Effect.Effect<void>;
}

/** Starts the service on its own runtime; `close` stops the sweeps and the wait it forked. */
export const createRoutineResults = Effect.fn("createRoutineResults")(function* (
  dependencies: RoutineResultsDependencies,
) {
  const runtime = ManagedRuntime.make(RoutineResults.layer(dependencies));
  const context = yield* runtime.contextEffect.pipe(
    Effect.onExit((exit) => (Exit.isFailure(exit) ? runtime.disposeEffect : Effect.void)),
  );
  const service = Context.get(context, RoutineResults);
  return { ...service, close: () => runtime.disposeEffect } satisfies RoutineResultsHandle;
});

/** 1, 2, 4 and 8 minutes, then each 15 minutes. */
function retryDelay(attempts: number): number {
  return Math.min(LONGEST_RETRY_MS, FIRST_RETRY_MS * 2 ** Math.max(0, attempts - 1));
}

/** What the place gets: the routine's name over its answer. Both are the user's and the agent's own text. */
export function resultText(routineName: string, answer: string): string {
  return `**${routineName}**\n\n${answer}`;
}
