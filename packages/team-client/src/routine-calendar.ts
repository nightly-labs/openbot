import { INPUT_LIMITS } from "@openbot/contracts/input-limits";
import {
  ROUTINE_MINIMUM_INTERVAL_MINUTES,
  type RoutineCalendar,
  type RoutineCalendarOwner,
  type RoutineCalendarRun,
  type RoutineFields,
  type RoutineRunFields,
} from "@openbot/contracts/ipc";
import { Effect } from "effect";
import { nextValidRoutineOccurrence, validateStoredRoutineSchedule } from "./routine-schedule";

const PARALLEL_REQUESTS = 8;

export interface RoutineCalendarSource<E> {
  owners(): Effect.Effect<RoutineCalendarOwner[], E>;
  routines(owner: RoutineCalendarOwner): Effect.Effect<RoutineFields[], E>;
  runs(owner: RoutineCalendarOwner, routineId: string, limit: number): Effect.Effect<RoutineRunFields[], E>;
}

export const buildRoutineCalendar = Effect.fn("RoutineCalendar.build")(function* <E>(
  range: { from: Date; to: Date },
  now: Date,
  source: RoutineCalendarSource<E>,
): Effect.fn.Return<RoutineCalendar, E> {
  const owners = yield* source.owners();
  const lists = yield* Effect.forEach(
    owners,
    (owner) => source.routines(owner).pipe(Effect.map((routines) => routines.map((routine) => ({ owner, routine })))),
    { concurrency: PARALLEL_REQUESTS },
  );
  const routines = lists.flat();
  const runLists = yield* Effect.forEach(
    routines,
    ({ owner, routine }) =>
      Effect.gen(function* () {
        const history =
          range.from.getTime() < now.getTime()
            ? yield* source.runs(owner, routine.id, INPUT_LIMITS.routineRunsPage)
            : [];
        yield* Effect.callback<void>((resume) => {
          const timer = setTimeout(() => resume(Effect.void), 0);
          return Effect.sync(() => clearTimeout(timer));
        });
        return routineRuns(routine, history, range, now);
      }),
    { concurrency: PARALLEL_REQUESTS },
  );
  return {
    routines: routines.map(({ owner, routine }) => ({
      id: routine.id,
      name: routine.name,
      owner,
      active: routine.active,
      timezone: routine.timezone,
      schedule: routine.trigger.schedule,
    })),
    runs: runLists.flat(),
  };
});

function routineRuns(
  routine: RoutineFields,
  history: RoutineRunFields[],
  range: { from: Date; to: Date },
  now: Date,
): RoutineCalendarRun[] {
  const runs: RoutineCalendarRun[] = [];
  const made = new Set<number>();
  for (const run of history) {
    const at = Date.parse(run.scheduledFor);
    if (!(at >= range.from.getTime() && at < range.to.getTime())) continue;
    made.add(at);
    runs.push({ id: run.id, routineId: routine.id, at: new Date(at).toISOString(), status: run.status });
  }
  try {
    validateStoredRoutineSchedule(routine.trigger.schedule, routine.timezone);
  } catch {
    return runs;
  }
  const maxRuns =
    Math.ceil((range.to.getTime() - range.from.getTime()) / (ROUTINE_MINIMUM_INTERVAL_MINUTES * 60_000)) + 1;
  let cursor = new Date(Math.max(range.from.getTime() - 1, now.getTime()));
  for (let count = 0; count < maxRuns; count += 1) {
    let next: Date;
    try {
      next = nextValidRoutineOccurrence(routine.trigger.schedule, routine.timezone, cursor);
    } catch {
      break;
    }
    if (next.getTime() >= range.to.getTime()) break;
    if (!made.has(next.getTime())) {
      runs.push({
        id: `${routine.id}@${next.toISOString()}`,
        routineId: routine.id,
        at: next.toISOString(),
        status: "scheduled",
      });
    }
    cursor = next;
  }
  return runs;
}
