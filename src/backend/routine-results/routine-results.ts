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

const SWEEP_WINDOW_MS = 7 * 24 * 60 * 60 * 1000;
const FIRST_RETRY_MS = 60 * 1000;
const LONGEST_RETRY_MS = 15 * 60 * 1000;
const TEAMMATE_ANSWER_WAIT_MS = 24 * 60 * 60 * 1000;

class RoutineResultFailed extends Schema.TaggedError<RoutineResultFailed>()("RoutineResultFailed", {
  cause: Schema.Defect(),
}) {}

export class RoutineResultError extends Error {}

export interface RoutineResultsDependencies {
  store: RoutineResultStore;
  runTurns(deliveryId: string): { turnIds: string[]; waiting: boolean } | null;
  turnAnswer(agentId: string, turnId: string): string | null;
  connection(connectionId: string): { platform: MessagingPlatform; name: string } | null;
  options(): Effect.Effect<RoutineResultConnectionOption[]>;
  post(
    connectionId: string,
    placeId: string,
    markdown: string,
  ): Effect.Effect<{ posted: true } | { failure: MessagingPostFailure }>;
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
  recover(): Effect.Effect<void>;
  sweep(): Effect.Effect<void>;
  notice(event: AgentEvent): Effect.Effect<void>;
}

export function routineResultNoticeEvent(event: AgentEvent): boolean {
  return event.type === "turn-completed" || event.type === "queue-changed" || event.type === "routines-changed";
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
        let sweeping = false;
        let again = false;
        let timer: Fiber.Fiber<void> | null = null;
        let waitEndsAt: string | null = null;

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
            store.resend(input.runId, now().toISOString());
          });
          dependencies.changed([input.agentId]);
          yield* Effect.forkIn(sweep(), scope);
        });

        const recordAnswers = (since: string, at: string): Set<string> => {
          const changed = new Set<string>();
          const waitedSince = new Date(Date.parse(at) - TEAMMATE_ANSWER_WAIT_MS).toISOString();
          waitEndsAt = null;
          for (const run of store.runsWithoutDelivery(since)) {
            const turns = run.deliveryId ? dependencies.runTurns(run.deliveryId) : null;
            if (turns?.waiting && run.endedAt > waitedSince) {
              const endsAt = new Date(Date.parse(run.endedAt) + TEAMMATE_ANSWER_WAIT_MS).toISOString();
              if (!waitEndsAt || endsAt < waitEndsAt) waitEndsAt = endsAt;
              continue;
            }
            let output: string | null = null;
            for (const turnId of turns?.turnIds ?? []) {
              output = dependencies.turnAnswer(run.agentId, turnId);
              if (output) break;
            }
            const answer = output && !isNoUpdateAnswer(output) ? output : null;
            store.createDelivery(run, answer ? resultText(run.routineName, answer) : null, at);
            if (answer) changed.add(run.agentId);
          }
          return changed;
        };

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

        const schedule = Effect.fn("RoutineResults.schedule")(function* (shortest: number) {
          const previous = timer;
          const attemptAt = store.nextAttemptAt();
          const next =
            attemptAt && waitEndsAt ? (attemptAt < waitEndsAt ? attemptAt : waitEndsAt) : (attemptAt ?? waitEndsAt);
          const delay = next ? Math.max(shortest, Date.parse(next) - now().getTime()) : null;
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
          const touched = yield* lock.withPermit(attempt(() => store.interruptSending(now().toISOString()))).pipe(
            Effect.catchCause((cause) =>
              Effect.sync(() => {
                logger.warn("Interrupted routine results were not marked.", { cause: String(cause) });
                return [];
              }),
            ),
          );
          if (touched.length > 0) dependencies.changed(touched);
          yield* Effect.forkIn(sweep(), scope);
        });

        const notice = Effect.fn("RoutineResults.notice")(function* (event: AgentEvent) {
          if (!routineResultNoticeEvent(event)) return;
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

function retryDelay(attempts: number): number {
  return Math.min(LONGEST_RETRY_MS, FIRST_RETRY_MS * 2 ** Math.max(0, attempts - 1));
}

export function resultText(routineName: string, answer: string): string {
  return `**${routineName}**\n\n${answer}`;
}
