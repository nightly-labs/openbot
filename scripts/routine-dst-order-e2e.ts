// Run: bun scripts/routine-dst-order-e2e.ts
// Report: .openbot-build/routine-dst-order-e2e.json

import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import type { RoutineSchedule } from "@openbot/contracts/ipc";
import { Effect } from "effect";
import { AgentRoutineStore } from "../src/backend/agent-routine-store";
import { OpenBotDatabase } from "../src/backend/openbot-database";

interface ScheduleCase {
  name: string;
  timezone: string;
  after: string;
  expected: string;
  schedule: RoutineSchedule;
}

const stepped: RoutineSchedule = { kind: "custom", expression: "*/20 * * * *" };
const minuteList: RoutineSchedule = { kind: "custom", expression: "0,20,40 * * * *" };
const cases: ScheduleCase[] = [
  {
    name: "ordinary-date",
    timezone: "America/New_York",
    after: "2026-10-14T05:30:00.000Z",
    expected: "2026-10-14T05:40:00.000Z",
    schedule: stepped,
  },
  {
    name: "ny-first-occurrence",
    timezone: "America/New_York",
    after: "2026-11-01T05:30:00.000Z",
    expected: "2026-11-01T05:40:00.000Z",
    schedule: stepped,
  },
  {
    name: "ny-second-occurrence",
    timezone: "America/New_York",
    after: "2026-11-01T06:30:00.000Z",
    expected: "2026-11-01T06:40:00.000Z",
    schedule: stepped,
  },
  {
    name: "ny-first-minute-list",
    timezone: "America/New_York",
    after: "2026-11-01T05:30:00.000Z",
    expected: "2026-11-01T05:40:00.000Z",
    schedule: minuteList,
  },
  {
    name: "ny-second-minute-list",
    timezone: "America/New_York",
    after: "2026-11-01T06:30:00.000Z",
    expected: "2026-11-01T06:40:00.000Z",
    schedule: minuteList,
  },
  {
    name: "ny-strict-after-first",
    timezone: "America/New_York",
    after: "2026-11-01T05:40:00.000Z",
    expected: "2026-11-01T06:00:00.000Z",
    schedule: stepped,
  },
  {
    name: "ny-strict-after-second",
    timezone: "America/New_York",
    after: "2026-11-01T06:40:00.000Z",
    expected: "2026-11-01T07:00:00.000Z",
    schedule: stepped,
  },
  {
    name: "ny-daily-second-occurrence",
    timezone: "America/New_York",
    after: "2026-11-01T05:30:00.000Z",
    expected: "2026-11-01T06:20:00.000Z",
    schedule: { kind: "daily", time: "01:20" },
  },
  {
    name: "ny-before-fold",
    timezone: "America/New_York",
    after: "2026-11-01T04:50:00.000Z",
    expected: "2026-11-01T05:00:00.000Z",
    schedule: stepped,
  },
  {
    name: "ny-spring-forward",
    timezone: "America/New_York",
    after: "2026-03-08T06:50:00.000Z",
    expected: "2026-03-08T07:00:00.000Z",
    schedule: stepped,
  },
  {
    name: "ny-spring-missing-daily-time",
    timezone: "America/New_York",
    after: "2026-03-08T05:00:00.000Z",
    expected: "2026-03-09T06:20:00.000Z",
    schedule: { kind: "daily", time: "02:20" },
  },
  {
    name: "lord-howe-first-minute-list",
    timezone: "Australia/Lord_Howe",
    after: "2026-04-04T14:35:00.000Z",
    expected: "2026-04-04T14:50:00.000Z",
    schedule: { kind: "custom", expression: "30,50 1 * * *" },
  },
  {
    name: "lord-howe-end-first-occurrence",
    timezone: "Australia/Lord_Howe",
    after: "2026-04-04T14:45:00.000Z",
    expected: "2026-04-04T15:10:00.000Z",
    schedule: stepped,
  },
  {
    name: "lord-howe-second-occurrence",
    timezone: "Australia/Lord_Howe",
    after: "2026-04-04T15:05:00.000Z",
    expected: "2026-04-04T15:10:00.000Z",
    schedule: stepped,
  },
  {
    name: "casey-first-occurrence",
    timezone: "Antarctica/Casey",
    after: "2023-03-08T14:30:00.000Z",
    expected: "2023-03-08T14:40:00.000Z",
    schedule: stepped,
  },
  {
    name: "casey-end-first-occurrence",
    timezone: "Antarctica/Casey",
    after: "2023-03-08T15:50:00.000Z",
    expected: "2023-03-08T16:00:00.000Z",
    schedule: stepped,
  },
  {
    name: "casey-earlier-wall-hour",
    timezone: "Antarctica/Casey",
    after: "2023-03-08T15:50:00.000Z",
    expected: "2023-03-08T16:20:00.000Z",
    schedule: { kind: "daily", time: "00:20" },
  },
  {
    name: "casey-second-occurrence",
    timezone: "Antarctica/Casey",
    after: "2023-03-08T16:30:00.000Z",
    expected: "2023-03-08T16:40:00.000Z",
    schedule: stepped,
  },
  {
    name: "interval-across-fold",
    timezone: "America/New_York",
    after: "2026-11-01T05:40:00.000Z",
    expected: "2026-11-01T06:00:00.000Z",
    schedule: { kind: "interval", amount: 20, unit: "minutes", anchorAt: "2026-11-01T05:00:00.000Z" },
  },
  {
    name: "interval-before-anchor",
    timezone: "America/New_York",
    after: "2026-11-01T04:30:00.000Z",
    expected: "2026-11-01T05:00:00.000Z",
    schedule: { kind: "interval", amount: 20, unit: "minutes", anchorAt: "2026-11-01T05:00:00.000Z" },
  },
];

const artifactDirectory = resolve(dirname(import.meta.filename), "../.openbot-build");
const temporaryDirectory = await mkdtemp(join(tmpdir(), "openbot-routine-dst-order-"));
const database = new OpenBotDatabase(temporaryDirectory);
const results: {
  name: string;
  timezone: string;
  after: string;
  expected: string;
  created: string;
  persisted: string | null;
  passed: boolean;
}[] = [];
let failure: string | null = null;

try {
  await Effect.runPromise(database.initialize());
  const store = new AgentRoutineStore(database);
  const saved = cases.map((fixture) => {
    const routine = store.create(
      {
        agentId: fixture.name,
        name: fixture.name,
        instruction: "Check the scheduled time.",
        active: true,
        timezone: fixture.timezone,
        schedule: fixture.schedule,
      },
      new Date(fixture.after),
    );
    return { fixture, routine };
  });

  database.close();
  await Effect.runPromise(database.initialize());
  const reopenedStore = new AgentRoutineStore(database);
  for (const { fixture, routine } of saved) {
    const persisted = reopenedStore.get(fixture.name, routine.id)?.trigger.nextRunAt ?? null;
    results.push({
      name: fixture.name,
      timezone: fixture.timezone,
      after: fixture.after,
      expected: fixture.expected,
      created: routine.trigger.nextRunAt,
      persisted,
      passed: routine.trigger.nextRunAt === fixture.expected && persisted === fixture.expected,
    });
  }
  const failed = results.filter((result) => !result.passed);
  if (failed.length > 0)
    throw new Error(`Unexpected scheduled times: ${failed.map((result) => result.name).join(", ")}`);
} catch (error) {
  failure = error instanceof Error ? error.message : String(error);
  process.exitCode = 1;
} finally {
  try {
    database.close();
  } finally {
    await rm(temporaryDirectory, { recursive: true, force: true });
  }
  await mkdir(artifactDirectory, { recursive: true });
  const artifact = join(artifactDirectory, "routine-dst-order-e2e.json");
  await writeFile(artifact, `${JSON.stringify({ passed: failure === null, failure, results }, null, 2)}\n`);
  process.stdout.write(`${artifact}\n`);
  if (failure) process.stderr.write(`${failure}\n`);
}
