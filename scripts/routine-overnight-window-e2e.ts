// Checks hourly routines between two times that cross midnight (#2922). Each draft goes through the
// shared draft conversion, the real routine store on a temporary SQLite file, and the real cron
// schedule. The runs must match the window, and the saved schedule must read back as the same draft.
// The days of a run are the days of its own date, as cron checks them.
//
// Run: bun scripts/routine-overnight-window-e2e.ts
// Writes .openbot-build/routine-overnight-window-e2e/report.json and exits non-zero on a failure.
import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { nextRoutineOccurrence } from "@openbot/team-client/routine-schedule";
import {
  ROUTINE_EVERY_DAY,
  ROUTINE_WORKDAYS,
  type RoutineScheduleDraft,
  routineDraftProblemCode,
  routineRunsPerDay,
  routineScheduleFromDraft,
  routineScheduleToDraft,
} from "@openbot/team-client/routine-schedule-draft";
import { Effect } from "effect";
import { AgentRoutineStore } from "../src/backend/agent-routine-store";
import { OpenBotDatabase } from "../src/backend/openbot-database";

type HourlyDraft = Extract<RoutineScheduleDraft, { kind: "hourly" }>;

interface WindowCase {
  name: string;
  draft: HourlyDraft;
  cron: string;
  runsPerDay: number;
  /** The draft the saved schedule reads back as. A window end moves to its last run. */
  readBack: HourlyDraft;
}

const OUT = resolve(import.meta.dirname, "../.openbot-build/routine-overnight-window-e2e");
// A Monday, so a Monday-to-Friday window has a Saturday and a Sunday in the 7 days checked.
const START = new Date("2035-01-01T00:00:00.000Z");
const DAYS_CHECKED = 7;
const MINUTE_MS = 60_000;

function hourly(start: string, end: string, everyHours = 1, days = ROUTINE_EVERY_DAY): HourlyDraft {
  return { kind: "hourly", everyHours, days, window: { start, end } };
}

const cases: WindowCase[] = [
  {
    name: "issue-8pm-to-10am-hourly",
    draft: hourly("20:00", "10:00"),
    cron: "0 20-23,0-10 * * *",
    runsPerDay: 15,
    readBack: hourly("20:00", "10:00"),
  },
  {
    name: "8pm-to-10am-every-3h",
    draft: hourly("20:00", "10:00", 3),
    cron: "0 20-23/3,2-10/3 * * *",
    runsPerDay: 5,
    readBack: hourly("20:00", "10:00", 3),
  },
  {
    name: "8pm-to-10am-every-8h",
    draft: hourly("20:00", "10:00", 8),
    cron: "0 20-23/8,4-10/8 * * *",
    runsPerDay: 2,
    readBack: hourly("20:00", "10:00", 8),
  },
  {
    name: "half-past-window",
    draft: hourly("20:30", "09:30"),
    cron: "30 20-23,0-9 * * *",
    runsPerDay: 14,
    readBack: hourly("20:30", "09:30"),
  },
  {
    name: "end-before-last-step",
    draft: hourly("20:30", "10:00", 2),
    cron: "30 20-23/2,0-9/2 * * *",
    runsPerDay: 7,
    readBack: hourly("20:30", "09:30", 2),
  },
  {
    name: "11pm-to-1am",
    draft: hourly("23:00", "01:00"),
    cron: "0 23-23,0-1 * * *",
    runsPerDay: 3,
    readBack: hourly("23:00", "01:00"),
  },
  {
    name: "no-run-after-midnight",
    draft: hourly("22:00", "01:00", 8),
    cron: "0 22-23/8 * * *",
    runsPerDay: 1,
    readBack: hourly("22:00", "23:00", 8),
  },
  {
    name: "weekdays-overnight",
    draft: hourly("20:00", "10:00", 1, ROUTINE_WORKDAYS),
    cron: "0 20-23,0-10 * * 1,2,3,4,5",
    runsPerDay: 15,
    readBack: hourly("20:00", "10:00", 1, ROUTINE_WORKDAYS),
  },
  {
    name: "same-day-window-unchanged",
    draft: hourly("09:00", "18:00"),
    cron: "0 9-18 * * *",
    runsPerDay: 10,
    readBack: hourly("09:00", "18:00"),
  },
];

/** The runs a window gives in the checked days, from its own rule: steps from the start, on the days of each run's date. */
function expectedRuns(draft: HourlyDraft): string[] {
  const window = draft.window;
  assert.ok(window);
  const minutes = (clock: string) => {
    const [hour = 0, minute = 0] = clock.split(":").map(Number);
    return hour * 60 + minute;
  };
  const start = minutes(window.start);
  const end = minutes(window.end) < start ? minutes(window.end) + 24 * 60 : minutes(window.end);
  const runs: string[] = [];
  // The window of the day before the first day can have runs after its midnight.
  for (let day = -1; day < DAYS_CHECKED; day += 1) {
    for (let offset = start; offset <= end; offset += draft.everyHours * 60) {
      const run = new Date(START.getTime() + (day * 24 * 60 + offset) * MINUTE_MS);
      if (run < START || run.getTime() >= START.getTime() + DAYS_CHECKED * 24 * 60 * MINUTE_MS) continue;
      if (draft.days.includes(run.getUTCDay())) runs.push(run.toISOString());
    }
  }
  return runs.sort();
}

interface CaseReport {
  name: string;
  cron?: string;
  runsPerDay?: number;
  runs?: number;
  firstRuns?: string[];
  passed: boolean;
  error?: string;
}

const reports: CaseReport[] = [];
const root = await mkdtemp(join(tmpdir(), "openbot-routine-overnight-"));
const database = new OpenBotDatabase(root);
let fatal: string | undefined;

try {
  await Effect.runPromise(database.initialize());
  const store = new AgentRoutineStore(database);
  const saved = cases.map((fixture) => {
    const routine = store.create(
      {
        agentId: fixture.name,
        name: fixture.name,
        instruction: "Check the overnight window.",
        active: true,
        timezone: "UTC",
        schedule: routineScheduleFromDraft(fixture.draft),
      },
      // Just before the checked days, so the first run is the first one inside them.
      new Date(START.getTime() - MINUTE_MS),
    );
    return { fixture, routine };
  });

  // Reads come from the reopened SQLite file, not from the rows the create returned.
  database.close();
  await Effect.runPromise(database.initialize());
  const reopened = new AgentRoutineStore(database);
  for (const { fixture, routine } of saved) {
    const report: CaseReport = { name: fixture.name, passed: false };
    reports.push(report);
    try {
      assert.equal(routineDraftProblemCode(fixture.draft), null, "The draft can be saved.");
      report.runsPerDay = routineRunsPerDay(fixture.draft.window, fixture.draft.everyHours);
      assert.equal(report.runsPerDay, fixture.runsPerDay);
      const loaded = reopened.get(fixture.name, routine.id);
      assert.ok(loaded, "The routine reads back after a reopen.");
      const schedule = loaded.trigger.schedule;
      assert.ok(schedule.kind === "custom", "An hourly window saves as a cron expression.");
      report.cron = schedule.expression;
      assert.equal(schedule.expression, fixture.cron);
      const expected = expectedRuns(fixture.draft);
      assert.equal(loaded.trigger.nextRunAt, expected[0], "The stored next run is the first run of the window.");
      const runs: string[] = [];
      const limit = START.getTime() + DAYS_CHECKED * 24 * 60 * MINUTE_MS;
      for (
        let run = nextRoutineOccurrence(schedule, "UTC", new Date(START.getTime() - MINUTE_MS));
        run.getTime() < limit;
        run = nextRoutineOccurrence(schedule, "UTC", run)
      ) {
        runs.push(run.toISOString());
      }
      assert.deepEqual(runs, expected);
      report.runs = runs.length;
      report.firstRuns = runs.slice(0, 6);
      assert.deepEqual(routineScheduleToDraft(schedule), fixture.readBack);
      // A second save of the read-back draft writes the same cron, so an edit does not move the runs.
      assert.deepEqual(routineScheduleFromDraft(fixture.readBack), schedule);
      report.passed = true;
    } catch (error) {
      report.error = error instanceof Error ? error.message : String(error);
    }
  }
} catch (error) {
  fatal = error instanceof Error ? error.message : String(error);
} finally {
  database.close();
  await rm(root, { recursive: true, force: true });
}

const passed = !fatal && reports.length === cases.length && reports.every((report) => report.passed);
await mkdir(OUT, { recursive: true });
await writeFile(
  join(OUT, "report.json"),
  `${JSON.stringify({ start: START.toISOString(), daysChecked: DAYS_CHECKED, fatal, passed, cases: reports }, null, 2)}\n`,
);
for (const report of reports) {
  process.stdout.write(`${report.passed ? "ok  " : "FAIL"} ${report.name}${report.error ? `: ${report.error}` : ""}\n`);
}
if (fatal) process.stderr.write(`fatal: ${fatal}\n`);
process.stdout.write(`${join(OUT, "report.json")}\n`);
if (!passed) process.exitCode = 1;
