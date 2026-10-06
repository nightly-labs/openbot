import { Effect } from "effect";

// @vitest-environment node

import type { RoutineCalendarOwner, RoutineFields, RoutineRunFields, RoutineSchedule } from "@openbot/contracts/ipc";
import { describe, expect, it, vi } from "vitest";
import { buildRoutineCalendar, type RoutineCalendarSource } from "./routine-calendar";

const OWNER: RoutineCalendarOwner = { kind: "agent", agentId: "chief" };

function routine(schedule: RoutineSchedule, active = true): RoutineFields {
  return {
    id: "brief",
    name: "Morning brief",
    instruction: "Brief",
    active,
    timezone: "Europe/Warsaw",
    trigger: {
      id: "trigger",
      routineId: "brief",
      schedule,
      nextRunAt: "2026-10-01T07:00:00.000Z",
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-01T00:00:00.000Z",
    },
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
  };
}

function run(scheduledFor: string, status: RoutineRunFields["status"]): RoutineRunFields {
  return {
    id: `run-${scheduledFor}`,
    routineId: "brief",
    triggerId: "trigger",
    kind: "scheduled",
    scheduledFor,
    routineName: "Morning brief",
    instruction: "Brief",
    status,
    error: null,
    createdAt: scheduledFor,
    updatedAt: scheduledFor,
  };
}

function source(routines: RoutineFields[], history: RoutineRunFields[] = []) {
  const runs = vi.fn(() => Effect.succeed(history));
  const calendarSource: RoutineCalendarSource<never> = {
    owners: () => Effect.succeed([OWNER]),
    routines: () => Effect.succeed(routines),
    runs,
  };
  return { calendarSource, runs };
}

function range(from: string, to: string) {
  return { from: new Date(from), to: new Date(to) };
}

describe("routine calendar", () => {
  it("keeps a past run in place of its planned run and drops runs outside the range", async () => {
    const { calendarSource } = source(
      [routine({ kind: "daily", time: "09:00" })],
      [
        run("2026-10-02T07:00:00.000Z", "failed"),
        run("2026-10-01T07:00:00.000Z", "succeeded"),
        run("2026-09-20T07:00:00.000Z", "succeeded"),
      ],
    );
    const calendar = await Effect.runPromise(
      buildRoutineCalendar(
        range("2026-10-01T00:00:00.000Z", "2026-10-04T00:00:00.000Z"),
        new Date("2026-10-02T06:00:00.000Z"),
        calendarSource,
      ),
    );

    expect(calendar.runs.map(({ at, status }) => [at, status])).toEqual([
      ["2026-10-02T07:00:00.000Z", "failed"],
      ["2026-10-01T07:00:00.000Z", "succeeded"],
      ["2026-10-03T07:00:00.000Z", "scheduled"],
    ]);
  });

  it("plans the runs of a paused routine and keeps the local time across a daylight-saving change", async () => {
    const { calendarSource, runs } = source([routine({ kind: "daily", time: "09:00" }, false)]);
    const calendar = await Effect.runPromise(
      buildRoutineCalendar(
        range("2026-10-24T00:00:00.000Z", "2026-10-27T00:00:00.000Z"),
        new Date("2026-10-23T00:00:00.000Z"),
        calendarSource,
      ),
    );

    expect(calendar.routines[0]).toMatchObject({ active: false, owner: OWNER });
    expect(calendar.runs.map((planned) => planned.at)).toEqual([
      "2026-10-24T07:00:00.000Z",
      "2026-10-25T08:00:00.000Z",
      "2026-10-26T08:00:00.000Z",
    ]);
    // A range that starts after now has no history to read.
    expect(runs).not.toHaveBeenCalled();
  });

  it("keeps the past runs of a schedule that no longer validates and plans none", async () => {
    const { calendarSource } = source(
      [routine({ kind: "daily", time: "25:99" })],
      [run("2026-10-01T07:00:00.000Z", "succeeded")],
    );
    const calendar = await Effect.runPromise(
      buildRoutineCalendar(
        range("2026-10-01T00:00:00.000Z", "2026-10-08T00:00:00.000Z"),
        new Date("2026-10-02T00:00:00.000Z"),
        calendarSource,
      ),
    );

    expect(calendar.runs.map(({ at, status }) => [at, status])).toEqual([["2026-10-01T07:00:00.000Z", "succeeded"]]);
  });

  it("plans every run of the shortest interval in the range", async () => {
    const { calendarSource } = source([
      routine({ kind: "interval", amount: 3, unit: "minutes", anchorAt: "2026-10-01T00:00:00.000Z" }),
    ]);
    const calendar = await Effect.runPromise(
      buildRoutineCalendar(
        range("2026-10-02T00:00:00.000Z", "2026-10-09T00:00:00.000Z"),
        new Date("2026-10-01T00:00:00.000Z"),
        calendarSource,
      ),
    );

    expect(calendar.runs).toHaveLength(7 * 480);
    expect(calendar.runs.at(-1)?.at).toBe("2026-10-08T23:57:00.000Z");
  });
});
