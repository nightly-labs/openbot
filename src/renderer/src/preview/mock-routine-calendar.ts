import type {
  Routine,
  RoutineCalendar,
  RoutineCalendarInput,
  RoutineCalendarRun,
  RoutineRun,
  RoutineSchedule,
} from "@openbot/contracts/ipc";

const HOUR = 3_600_000;
const DAY = 24 * HOUR;
const MAX_RUNS = 500;

/**
 * The preview calendar. The host expands each schedule with its cron code in the routine's zone; the
 * preview steps from the stored next run by the schedule's period, which is the same away from a
 * daylight-saving change. A custom or advanced schedule shows only its next run.
 */
export function mockRoutineCalendar(
  input: RoutineCalendarInput,
  routines: ReadonlyMap<string, Routine[]>,
  routineRuns: ReadonlyMap<string, RoutineRun[]>,
  now = Date.now(),
): RoutineCalendar {
  const from = Date.parse(input.from);
  const to = Date.parse(input.to);
  const all = [...routines.values()].flat();
  const runs: RoutineCalendarRun[] = [];
  for (const routine of all) {
    for (const run of routineRuns.get(routine.id) ?? []) {
      const at = Date.parse(run.scheduledFor);
      if (at >= from && at < to)
        runs.push({ id: run.id, routineId: routine.id, at: run.scheduledFor, status: run.status });
    }
    let at = Date.parse(routine.trigger.nextRunAt);
    for (let count = 0; count < MAX_RUNS && at < to; count += 1) {
      if (at >= from && at >= now) {
        const iso = new Date(at).toISOString();
        runs.push({ id: `${routine.id}@${iso}`, routineId: routine.id, at: iso, status: "scheduled" });
      }
      const next = nextAt(routine.trigger.schedule, at);
      if (next === null) break;
      at = next;
    }
  }
  return {
    routines: all.map((routine) => ({
      id: routine.id,
      name: routine.name,
      owner: { kind: "agent", agentId: routine.agentId },
      active: routine.active,
      timezone: routine.timezone,
      schedule: routine.trigger.schedule,
    })),
    runs,
  };
}

function nextAt(schedule: RoutineSchedule, at: number): number | null {
  switch (schedule.kind) {
    case "hourly":
      return at + HOUR;
    case "daily":
      return at + DAY;
    case "weekdays": {
      const weekday = new Date(at + DAY).getUTCDay();
      return at + (weekday === 6 ? 3 : weekday === 0 ? 2 : 1) * DAY;
    }
    case "weekly":
      return at + 7 * DAY;
    case "monthly": {
      const date = new Date(at);
      date.setUTCMonth(date.getUTCMonth() + 1);
      return date.getTime();
    }
    case "interval":
      return at + schedule.amount * (schedule.unit === "minutes" ? 60_000 : schedule.unit === "hours" ? HOUR : DAY);
    default:
      return null;
  }
}
