import { createHash, randomUUID } from "node:crypto";
import type {
  EventEnvelope,
  EventRoutine,
  EventRoutineOwner,
  SaveEventRoutineInput,
} from "@openbot/contracts/ipc-events";
import { sourceText } from "@openbot/i18n/source";
import { Effect, Schema } from "effect";
import { type EventDispatch, EventStore } from "./event-store";
import type { OpenBotDatabase } from "./openbot-database";

export interface EventRoutineQueueInput {
  routine: EventRoutine;
  envelope: EventEnvelope | null;
  /** Stable across retries and restarts for one accepted event and routine. */
  runId: string;
}

export interface EventRoutineQueueResult {
  runId: string;
}

export interface EventRoutineQueue {
  run(input: EventRoutineQueueInput): Effect.Effect<EventRoutineQueueResult, { readonly cause: unknown }>;
  test(input: EventRoutineQueueInput): Effect.Effect<EventRoutineQueueResult, { readonly cause: unknown }>;
}

/**
 * Creates the run id used by an event dispatch.
 *
 * Run ids are also embedded in conversation item types. Keep this value short and free of the
 * separators used by those item types while preserving one id for the same source, event, and
 * routine after a retry or host restart.
 */
export function eventRoutineRunId(sourceId: string, eventId: string, routineId: string): string {
  return createHash("sha256")
    .update(JSON.stringify([sourceId, eventId, routineId]))
    .digest("hex")
    .slice(0, 32);
}

function eventRoutineTestRunId(routineId: string): string {
  return eventRoutineRunId("event-test", randomUUID(), routineId);
}

export interface ScheduledRoutinePort {
  list(owner: EventRoutineOwner): EventRoutine[];
  save(input: SaveEventRoutineInput): Effect.Effect<EventRoutine, { readonly cause: unknown }>;
  deactivate?(input: { id: string; owner: EventRoutineOwner }): Effect.Effect<void, { readonly cause: unknown }>;
  deleteEvent?(input: { id: string; owner: EventRoutineOwner }): Effect.Effect<void, { readonly cause: unknown }>;
  delete(input: { id: string; owner: EventRoutineOwner }): Effect.Effect<void, { readonly cause: unknown }>;
  test(input: { id: string; owner: EventRoutineOwner }): Effect.Effect<void, { readonly cause: unknown }>;
}

export interface EventRoutineSchedulerOptions {
  database: OpenBotDatabase;
  queues: {
    agent: EventRoutineQueue;
    channel: EventRoutineQueue;
  };
  scheduled: ScheduledRoutinePort;
  ownerExists(owner: EventRoutineOwner): boolean;
}

export class EventRoutineOperationFailed extends Schema.TaggedError<EventRoutineOperationFailed>()(
  "EventRoutineOperationFailed",
  { cause: Schema.Defect() },
) {}

function eventRoutineStep<A>(operation: () => A): Effect.Effect<A, EventRoutineOperationFailed> {
  return Effect.try({
    try: operation,
    catch: (cause) => new EventRoutineOperationFailed({ cause }),
  });
}

/**
 * Routes accepted envelopes to the existing agent and channel queues.
 *
 * The event tables are separate from the released schedule tables. This keeps old routine codecs
 * and run history stable while allowing an event routine to use the same queue and usage policy as
 * a scheduled run. A claimed dispatch remains pending when a queue rejects it, so a restart or a
 * later wake can retry the handoff.
 */
export class EventRoutineScheduler {
  readonly #store: EventStore;
  readonly #queues: EventRoutineSchedulerOptions["queues"];
  readonly #scheduled: ScheduledRoutinePort;
  readonly #ownerExists: EventRoutineSchedulerOptions["ownerExists"];

  constructor(options: EventRoutineSchedulerOptions) {
    this.#store = new EventStore(options.database);
    this.#queues = options.queues;
    this.#scheduled = options.scheduled;
    this.#ownerExists = options.ownerExists;
  }

  list(owner: EventRoutineOwner): EventRoutine[] {
    const eventRoutines = this.#store.listEventRoutines(owner);
    const eventIds = new Set(eventRoutines.map((routine) => routine.id));
    return [...this.#scheduled.list(owner).filter((routine) => !eventIds.has(routine.id)), ...eventRoutines];
  }

  readonly save = Effect.fn("EventRoutineScheduler.save")(function* (
    this: EventRoutineScheduler,
    input: SaveEventRoutineInput,
  ) {
    if (input.trigger.kind !== "event") {
      const eventRoutine = input.id ? this.#store.getEventRoutine(input.id) : null;
      if (eventRoutine && !sameOwner(eventRoutine.owner, input.owner)) {
        return yield* eventRoutineStep(() => {
          throw new Error(sourceText("error.backend.routineGone"));
        });
      }
      const converted = yield* this.#scheduled.save(input);
      if (eventRoutine) this.#store.deleteEventRoutine(eventRoutine.id);
      return converted;
    }
    const trigger = input.trigger;
    if (!this.#ownerExists(input.owner)) {
      return yield* eventRoutineStep(() => {
        throw new Error(sourceText("error.backend.routineGone"));
      });
    }
    const existingEvent = input.id ? this.#store.getEventRoutine(input.id) : null;
    if (existingEvent && !sameOwner(existingEvent.owner, input.owner)) {
      return yield* eventRoutineStep(() => {
        throw new Error(sourceText("error.backend.routineGone"));
      });
    }
    const scheduled = input.id ? this.#scheduled.list(input.owner).some((routine) => routine.id === input.id) : false;
    const saved = yield* eventRoutineStep(() => {
      if (!this.#store.listSources().some((source) => source.id === trigger.sourceId)) {
        throw new Error(sourceText("error.backend.eventSourceMissing"));
      }
      return this.#store.saveEventRoutine(input);
    });
    if (scheduled && this.#scheduled.deactivate) {
      const deactivated = yield* Effect.result(this.#scheduled.deactivate({ id: saved.id, owner: input.owner }));
      if (deactivated._tag === "Failure") {
        yield* eventRoutineStep(() => this.#store.deleteEventRoutine(saved.id));
        return yield* new EventRoutineOperationFailed({ cause: deactivated.failure.cause });
      }
    }
    return saved;
  }).bind(this);

  readonly delete = Effect.fn("EventRoutineScheduler.delete")(function* (
    this: EventRoutineScheduler,
    input: { id: string; owner: EventRoutineOwner },
  ) {
    const eventRoutine = this.#store.getEventRoutine(input.id);
    if (eventRoutine) {
      if (!sameOwner(eventRoutine.owner, input.owner)) {
        return yield* eventRoutineStep(() => {
          throw new Error(sourceText("error.backend.routineGone"));
        });
      }
      const deleteEvent = this.#scheduled.deleteEvent;
      if (deleteEvent) yield* deleteEvent(input);
      this.#store.deleteEventRoutine(input.id);
      return;
    }
    const scheduled = this.#scheduled.list(input.owner).some((routine) => routine.id === input.id);
    if (scheduled) return yield* this.#scheduled.delete(input);
    return yield* eventRoutineStep(() => {
      throw new Error(sourceText("error.backend.routineGone"));
    });
  }).bind(this);

  readonly test = Effect.fn("EventRoutineScheduler.test")(function* (
    this: EventRoutineScheduler,
    input: { id: string; owner: EventRoutineOwner },
  ) {
    const routine = this.#store.getEventRoutine(input.id);
    if (routine && !sameOwner(routine.owner, input.owner)) {
      return yield* eventRoutineStep(() => {
        throw new Error(sourceText("error.backend.routineGone"));
      });
    }
    if (!routine) {
      const scheduled = this.#scheduled.list(input.owner).some((item) => item.id === input.id);
      if (scheduled) return yield* this.#scheduled.test(input);
      return yield* eventRoutineStep(() => {
        throw new Error(sourceText("error.backend.routineGone"));
      });
    }
    const queue = this.#queues[routine.owner.kind];
    yield* queue
      .test({ routine, envelope: null, runId: eventRoutineTestRunId(routine.id) })
      .pipe(Effect.mapError((failure) => new EventRoutineOperationFailed({ cause: failure.cause })));
  }).bind(this);

  /** Claims and hands off all currently pending batches. Failed queue handoffs remain retryable. */
  readonly dispatch = Effect.fn("EventRoutineScheduler.dispatch")(function* (this: EventRoutineScheduler) {
    while (true) {
      const dispatches = yield* eventRoutineStep(() => this.#store.claimDispatches());
      if (dispatches.length === 0) return;
      for (const [index, dispatch] of dispatches.entries()) {
        const result = yield* Effect.result(this.#dispatchOne(dispatch));
        if (result._tag === "Failure") {
          for (const pending of dispatches.slice(index + 1)) {
            yield* eventRoutineStep(() => this.#store.markDispatch(pending.id, "pending", null, "batch_retry"));
          }
          return yield* result.failure;
        }
      }
    }
  }).bind(this);

  get store(): EventStore {
    return this.#store;
  }

  readonly #dispatchOne = Effect.fn("EventRoutineScheduler.dispatchOne")(function* (
    this: EventRoutineScheduler,
    dispatch: EventDispatch,
  ) {
    const routine = this.#store.getEventRoutine(dispatch.routineId);
    if (!routine) {
      yield* eventRoutineStep(() => this.#store.markDispatch(dispatch.id, "failed", null, "routine_unavailable"));
      return yield* new EventRoutineOperationFailed({ cause: new Error("event_routine_unavailable") });
    }
    if (!routine.active || !sameOwner(routine.owner, dispatch.owner)) {
      yield* eventRoutineStep(() => this.#store.markDispatch(dispatch.id, "failed", null, "routine_unavailable"));
      return yield* new EventRoutineOperationFailed({ cause: new Error("event_routine_unavailable") });
    }
    if (!this.#ownerExists(routine.owner)) {
      yield* eventRoutineStep(() => this.#store.markDispatch(dispatch.id, "failed", null, "owner_unavailable"));
      return yield* new EventRoutineOperationFailed({ cause: new Error("event_owner_unavailable") });
    }
    const queue = this.#queues[routine.owner.kind];
    const runId = eventRoutineRunId(dispatch.envelope.sourceId, dispatch.eventId, dispatch.routineId);
    yield* eventRoutineStep(() => this.#store.assignDispatchRun(dispatch.id, runId));
    const result = yield* Effect.result(queue.run({ routine, envelope: dispatch.envelope, runId }));
    if (result._tag === "Success") {
      if (result.success.runId !== runId) {
        yield* eventRoutineStep(() => this.#store.markDispatch(dispatch.id, "pending", null, "queue_retry"));
        return yield* new EventRoutineOperationFailed({ cause: new Error("event_queue_retry") });
      }
      yield* eventRoutineStep(() => this.#store.markDispatch(dispatch.id, "completed", runId));
      return;
    }
    // Queue failures include provider holds, deleted owners and transient queue races. Keep the
    // event claim pending. The next wake or restart retries it through the normal queue policy.
    yield* eventRoutineStep(() => this.#store.markDispatch(dispatch.id, "pending", null, "queue_retry"));
    return yield* new EventRoutineOperationFailed({ cause: new Error("event_queue_retry") });
  }).bind(this);
}

function sameOwner(left: EventRoutineOwner, right: EventRoutineOwner): boolean {
  return left.kind === right.kind && left.id === right.id;
}
