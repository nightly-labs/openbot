import { isRoutineSchedule, type RoutineSchedule } from "@openbot/contracts/ipc";
import { describe, expect, it } from "vitest";
import {
  type RoutineScheduleDraft,
  routineDraftSummary,
  routineHoursLabel,
  switchDraftKind,
  typedClockHour,
} from "./routine-schedule-draft";
import {
  ROUTINE_SAVED_DRAFT_KINDS,
  routineDraftProblem,
  routineScheduleFromDraft,
  routineScheduleToDraft,
} from "./routine-schedule-saved";

const ALL_MONTHS = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12];
const EVERY_DAY = [0, 1, 2, 3, 4, 5, 6];

const cases: { name: string; draft: RoutineScheduleDraft; saved: RoutineSchedule }[] = [
  {
    name: "every hour, every day",
    draft: { kind: "hourly", everyHours: 1, days: EVERY_DAY, window: null },
    saved: { kind: "hourly", minute: 0 },
  },
  {
    name: "every hour at a minute past",
    draft: { kind: "hourly", everyHours: 1, days: EVERY_DAY, window: null, minute: 15 },
    saved: { kind: "hourly", minute: 15 },
  },
  {
    name: "every 3 hours on workdays",
    draft: { kind: "hourly", everyHours: 3, days: [1, 2, 3, 4, 5], window: null },
    saved: {
      kind: "advanced",
      months: ALL_MONTHS,
      days: { kind: "days-of-week", days: [1, 2, 3, 4, 5] },
      time: { kind: "every", amount: 3, unit: "hours" },
    },
  },
  {
    name: "every 2 hours between 9 AM and 6 PM",
    draft: { kind: "hourly", everyHours: 2, days: [1, 2, 3, 4, 5], window: { start: "09:00", end: "18:00" } },
    saved: { kind: "custom", expression: "0 9-18/2 * * 1,2,3,4,5" },
  },
  {
    name: "every hour between 9:30 AM and 4:30 PM",
    draft: { kind: "hourly", everyHours: 1, days: EVERY_DAY, window: { start: "09:30", end: "16:30" } },
    saved: { kind: "custom", expression: "30 9-16 * * *" },
  },
  {
    name: "daily",
    draft: { kind: "daily", days: EVERY_DAY, time: "07:30" },
    saved: { kind: "daily", time: "07:30" },
  },
  {
    name: "workdays",
    draft: { kind: "daily", days: [1, 2, 3, 4, 5], time: "07:30" },
    saved: { kind: "weekdays", time: "07:30" },
  },
  {
    name: "some days",
    draft: { kind: "daily", days: [2, 4], time: "18:00" },
    saved: {
      kind: "advanced",
      months: ALL_MONTHS,
      days: { kind: "days-of-week", days: [2, 4] },
      time: { kind: "at-time", time: "18:00" },
    },
  },
  {
    name: "weekly",
    draft: { kind: "weekly", weekday: 1, time: "09:00" },
    saved: { kind: "weekly", weekday: 1, time: "09:00" },
  },
  {
    name: "monthly",
    draft: { kind: "monthly", day: 31, time: "09:00" },
    saved: { kind: "monthly", day: 31, time: "09:00" },
  },
  {
    name: "yearly",
    draft: { kind: "yearly", month: 3, day: 14, time: "10:00" },
    saved: {
      kind: "advanced",
      months: [3],
      days: { kind: "days-of-month", days: [14] },
      time: { kind: "at-time", time: "10:00" },
    },
  },
  {
    name: "custom",
    draft: { kind: "custom", expression: "15 8 1 * *" },
    saved: { kind: "custom", expression: "15 8 1 * *" },
  },
];

describe("routine schedule mapping", () => {
  it.each(cases)("saves $name as the simplest saved kind and reads it back", ({ draft, saved }) => {
    expect(routineScheduleFromDraft(draft)).toEqual(saved);
    expect(isRoutineSchedule(saved)).toBe(true);
    expect(routineScheduleToDraft(saved)).toEqual(draft);
  });

  it("reads a window end that is not on the run minute as the last run", () => {
    const draft: RoutineScheduleDraft = {
      kind: "hourly",
      everyHours: 1,
      days: EVERY_DAY,
      window: { start: "09:30", end: "17:00" },
    };
    expect(routineScheduleToDraft(routineScheduleFromDraft(draft))).toEqual({
      ...draft,
      window: { start: "09:30", end: "16:30" },
    });
  });

  it("shows schedules that the chips cannot show as an equivalent cron expression", () => {
    expect(
      routineScheduleToDraft({ kind: "interval", amount: 15, unit: "minutes", anchorAt: "2026-01-01T00:00:00Z" }),
    ).toEqual({ kind: "custom", expression: "*/15 * * * *" });
    expect(
      routineScheduleToDraft({
        kind: "advanced",
        months: [1, 7],
        days: { kind: "days-of-month", days: [1, 15] },
        time: { kind: "at-time", time: "06:05" },
      }),
    ).toEqual({ kind: "custom", expression: "5 6 1,15 1,7 *" });
    expect(routineScheduleToDraft({ kind: "custom", expression: "0 9 * * 1-5" })).toEqual({
      kind: "custom",
      expression: "0 9 * * 1-5",
    });
  });

  it("reads Sunday as 7 in a saved cron expression", () => {
    expect(routineScheduleToDraft({ kind: "custom", expression: "0 */2 * * 6-7" })).toEqual({
      kind: "hourly",
      everyHours: 2,
      days: [0, 6],
      window: null,
    });
  });

  it("does not offer a one-time run, which has no saved kind", () => {
    expect(ROUTINE_SAVED_DRAFT_KINDS.map((option) => option.value)).not.toContain("once");
    expect(() => routineScheduleFromDraft({ kind: "once", date: "2026-10-01", time: "09:00" })).toThrow();
  });
});

describe("routine schedule edits", () => {
  const today = new Date(2026, 8, 24, 10, 0);

  it("starts Custom from the run that was set, so the switch alone does not move it", () => {
    const weekdays: RoutineScheduleDraft = { kind: "daily", days: [1, 2, 3, 4, 5], time: "07:30" };
    expect(switchDraftKind(weekdays, "custom", today)).toEqual({ kind: "custom", expression: "30 7 * * 1,2,3,4,5" });
    const window: RoutineScheduleDraft = {
      kind: "hourly",
      everyHours: 2,
      days: EVERY_DAY,
      window: { start: "09:00", end: "18:00" },
    };
    expect(switchDraftKind(window, "custom", today)).toEqual(routineScheduleFromDraft(window));
  });

  it("keeps a monthly day 31 on a date that exists when the run becomes yearly", () => {
    const monthly: RoutineScheduleDraft = { kind: "monthly", day: 31, time: "09:00" };
    expect(switchDraftKind(monthly, "yearly", today)).toEqual({ kind: "yearly", month: 9, day: 30, time: "09:00" });
    const february = new Date(2026, 1, 10);
    expect(switchDraftKind(monthly, "yearly", february)).toMatchObject({ month: 2, day: 29 });
    expect(routineDraftProblem({ kind: "yearly", month: 9, day: 31, time: "09:00" })).toBe(
      "Choose a date that exists.",
    );
    expect(routineDraftProblem({ kind: "yearly", month: 2, day: 29, time: "09:00" })).toBeNull();
  });

  it("does not save an hours window that ends before it starts, or an empty cron", () => {
    expect(
      routineDraftProblem({ kind: "hourly", everyHours: 1, days: EVERY_DAY, window: { start: "22:00", end: "18:00" } }),
    ).toBe("End time must be after start time.");
    expect(routineDraftProblem({ kind: "custom", expression: "  " })).toBe("Enter a cron expression.");
    expect(routineDraftProblem({ kind: "daily", days: EVERY_DAY, time: "07:00" })).toBeNull();
  });

  it("shows the minute of an hourly run past the hour", () => {
    const draft: RoutineScheduleDraft = { kind: "hourly", everyHours: 1, days: EVERY_DAY, window: null, minute: 30 };
    expect(routineHoursLabel(draft.window, draft.minute)).toBe("All day at :30");
    expect(routineDraftSummary(draft)).toBe("Every hour at :30, every day");
  });

  it("reads a typed 24-hour value on the 12-hour clock", () => {
    expect(typedClockHour(18, "AM")).toEqual({ hour: 6, meridiem: "PM" });
    expect(typedClockHour(0, "PM")).toEqual({ hour: 12, meridiem: "AM" });
    expect(typedClockHour(9, "PM")).toEqual({ hour: 9, meridiem: "PM" });
  });
});
