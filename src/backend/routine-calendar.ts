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

export interface RoutineCalendarSource {
  owners(): Promise<RoutineCalendarOwner[]>;
  routines(owner: RoutineCalendarOwner): Promise<RoutineFields[]>;
  /** The newest runs of one routine, newest first. */
  runs(owner: RoutineCalendarOwner, routineId: string, limit: number): Promise<RoutineRunFields[]>;
}

export async function buildRoutineCalendar(
  range: { from: Date; to: Date },
  now: Date,
  source: RoutineCalendarSource,
): Promise<RoutineCalendar> {
  const owners = await source.owners();
  const routineLists = await mapLimited(owners, async (owner) =>
    (await source.routines(owner)).map((routine) => ({ owner, routine })),
  );
  const routines = routineLists.flat();
  const runLists = await mapLimited(routines, async ({ owner, routine }) => {
    // History reaches back from now, so a range that ends before the oldest run kept here has no history.
    const history =
      range.from.getTime() < now.getTime() ? await source.runs(owner, routine.id, INPUT_LIMITS.routineRunsPage) : [];
    return routineRuns(routine, history, range, now);
  });
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
}

/** Like `Promise.all` over `map`, with at most `PARALLEL_REQUESTS` calls in flight. Results keep the input order. */
async function mapLimited<T, R>(items: readonly T[], map: (item: T) => Promise<R>): Promise<R[]> {
  const results = new Array<R>(items.length);
  // The workers share one iterator, so each item is taken once.
  const queue = items.entries();
  const worker = async () => {
    for (const [index, item] of queue) results[index] = await map(item);
  };
  await Promise.all(Array.from({ length: Math.min(PARALLEL_REQUESTS, items.length) }, worker));
  return results;
}

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
