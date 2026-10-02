// The routine calendar: every routine of a host, of agents and channels, with its runs in a range.
// A past run comes from the run history, a later one from the schedule. The local host and a remote
// one give the same source, so both calendars place runs with the same schedule code.

import { INPUT_LIMITS } from "@openbot/contracts/input-limits";
import type {
  RoutineCalendar,
  RoutineCalendarOwner,
  RoutineCalendarRun,
  RoutineFields,
  RoutineRunFields,
} from "@openbot/contracts/ipc";
import { nextRoutineOccurrence } from "./routine-schedule";

/** A routine that runs every few minutes would fill the range; the calendar shows a count past this. */
const MAX_SCHEDULED_RUNS = 500;

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
  const routineLists = await Promise.all(
    owners.map(async (owner) => (await source.routines(owner)).map((routine) => ({ owner, routine }))),
  );
  const routines = routineLists.flat();
  const runLists = await Promise.all(
    routines.map(async ({ owner, routine }) => {
      // History reaches back from now, so a range that ends before the oldest run kept here has no history.
      const history =
        range.from.getTime() < now.getTime() ? await source.runs(owner, routine.id, INPUT_LIMITS.routineRunsPage) : [];
      return routineRuns(routine, history, range, now);
    }),
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
  let cursor = new Date(Math.max(range.from.getTime() - 1, now.getTime()));
  for (let count = 0; count < MAX_SCHEDULED_RUNS; count += 1) {
    let next: Date;
    try {
      next = nextRoutineOccurrence(routine.trigger.schedule, routine.timezone, cursor);
    } catch {
      // A stored schedule that no longer validates fires nothing either; its past runs still show.
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
