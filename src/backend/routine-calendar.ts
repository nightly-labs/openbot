import { Effect } from "effect";
// The routine calendar: every routine of a host, of agents and channels, with its runs in a range.
// A past run comes from the run history, a later one from the schedule. The local host and a remote
// one give the same source, so both calendars place runs with the same schedule code.

import { INPUT_LIMITS } from "@openbot/contracts/input-limits";
import {
  ROUTINE_MINIMUM_INTERVAL_MINUTES,
  type RoutineCalendar,
  type RoutineCalendarOwner,
  type RoutineCalendarRun,
  type RoutineFields,
  type RoutineRunFields,
} from "@openbot/contracts/ipc";
import { nextValidRoutineOccurrence, validateRoutineSchedule } from "./routine-schedule";

/** A remote host gets one request for each owner and each routine; this many run at the same time. */
const PARALLEL_REQUESTS = 8;

export interface RoutineCalendarSource<E> {
  owners(): Effect.Effect<RoutineCalendarOwner[], E>;
  routines(owner: RoutineCalendarOwner): Effect.Effect<RoutineFields[], E>;
  /** The newest runs of one routine, newest first. */
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
        // Give the native event loop a turn between schedule calculations.
        yield* Effect.callback<void>((resume) => {
          const immediate = setImmediate(() => resume(Effect.void));
          return Effect.sync(() => clearImmediate(immediate));
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
  // A paused routine keeps its place: the calendar shows the runs it would make if it resumed.
  try {
    validateRoutineSchedule(routine.trigger.schedule, routine.timezone);
  } catch {
    // A stored schedule that no longer validates fires nothing either; its past runs still show.
    return runs;
  }
  // Valid runs are at least the minimum interval apart, so the range holds no more than this.
  const maxRuns =
    Math.ceil((range.to.getTime() - range.from.getTime()) / (ROUTINE_MINIMUM_INTERVAL_MINUTES * 60_000)) + 1;
  let cursor = new Date(Math.max(range.from.getTime() - 1, now.getTime()));
  for (let count = 0; count < maxRuns; count += 1) {
    let next: Date;
    try {
      next = nextValidRoutineOccurrence(routine.trigger.schedule, routine.timezone, cursor);
    } catch {
      // An interval with an anchor that does not parse validates, but has no next run.
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
