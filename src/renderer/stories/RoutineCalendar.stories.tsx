import type { RoutineSchedule } from "@openbot/contracts/ipc";
import {
  RoutineCalendar,
  type RoutineCalendarAgent,
  type RoutineCalendarRoutine,
  type RoutineCalendarRun,
} from "@openbot/ui/features/conversation/RoutineCalendar";
import { fn } from "storybook/test";
import type { Meta, StoryObj } from "storybook-solidjs-vite";
import { STORY_AGENTS } from "./fixtures";

/*
 * Issue #1242: one place that shows when every routine runs, across all agents. The host expands
 * each schedule into runs; the calendar only places them. Runs before `now` carry their outcome,
 * runs after it carry the routine state. All times are wall-clock times in the viewer's zone.
 */

const WARSAW = "Europe/Warsaw";
const [chief, research, sales] = STORY_AGENTS;
const AGENTS: RoutineCalendarAgent[] = STORY_AGENTS;

interface StoryRoutine extends RoutineCalendarRoutine {
  paused?: boolean;
  /** Days on which the run failed, as "2026-10-13". */
  failedOn?: string[];
}

function routine(
  id: string,
  name: string,
  agents: (RoutineCalendarAgent | undefined)[],
  schedule: RoutineSchedule,
  extra: Pick<StoryRoutine, "paused" | "failedOn"> = {},
): StoryRoutine {
  return {
    id,
    name,
    agentIds: agents.flatMap((agent) => (agent ? [agent.id] : [])),
    schedule,
    ...extra,
  };
}

const ROUTINES: StoryRoutine[] = [
  routine("morning-brief", "Morning brief", [chief], { kind: "weekdays", time: "07:00" }),
  routine("paper-digest", "Paper digest", [research], { kind: "weekly", weekday: 1, time: "08:30" }),
  routine("inbox-triage", "Inbox triage", [chief], { kind: "daily", time: "09:00" }),
  routine("monthly-invoices", "Monthly invoices", [chief], { kind: "monthly", day: 15, time: "10:00" }),
  routine(
    "competitor-watch",
    "Competitor watch",
    [research],
    { kind: "daily", time: "12:00" },
    {
      failedOn: ["2026-10-13"],
    },
  ),
  routine("lead-follow-up", "Lead follow-up", [sales], { kind: "weekdays", time: "14:00" }),
  routine(
    "weekly-planning",
    "Weekly planning",
    [chief],
    { kind: "weekly", weekday: 5, time: "16:00" },
    {
      paused: true,
    },
  ),
  routine("pipeline-report", "Pipeline report", [sales, chief], { kind: "weekly", weekday: 4, time: "17:30" }),
];

/** Wednesday, October 14, 2026, 10:30 in Warsaw. */
const NOW = new Date("2026-10-14T08:30:00.000Z");
/** Wednesday, October 21, 2026. The clocks in Warsaw go back on Sunday, October 25. */
const NOW_BEFORE_CLOCK_CHANGE = new Date("2026-10-21T08:30:00.000Z");

function runsFor(routines: StoryRoutine[], now: Date, timeZone: string): RoutineCalendarRun[] {
  const first = addDays(now.toISOString().slice(0, 10), -21);
  const runs: RoutineCalendarRun[] = [];
  for (let offset = 0; offset < 49; offset += 1) {
    const day = addDays(first, offset);
    for (const item of routines) {
      const time = runTime(item.schedule, day);
      if (!time) continue;
      const at = zonedInstant(day, time, timeZone);
      const past = at.getTime() < now.getTime();
      runs.push({
        id: `${item.id}-${day}`,
        routineId: item.id,
        at: at.toISOString(),
        status: past ? (item.failedOn?.includes(day) ? "failed" : "completed") : item.paused ? "paused" : "active",
      });
    }
  }
  return runs;
}

/** The story schedules only: one wall-clock time on the days the schedule picks. */
function runTime(schedule: RoutineSchedule, day: string): string | null {
  const date = new Date(`${day}T12:00:00.000Z`);
  const weekday = date.getUTCDay();
  switch (schedule.kind) {
    case "daily":
      return schedule.time;
    case "weekdays":
      return weekday >= 1 && weekday <= 5 ? schedule.time : null;
    case "weekly":
      return weekday === schedule.weekday ? schedule.time : null;
    case "monthly":
      return date.getUTCDate() === schedule.day ? schedule.time : null;
    default:
      return null;
  }
}

function addDays(day: string, amount: number): string {
  const date = new Date(`${day}T12:00:00.000Z`);
  date.setUTCDate(date.getUTCDate() + amount);
  return date.toISOString().slice(0, 10);
}

/** The instant at which the wall clock in `timeZone` shows `time` on `day`. */
function zonedInstant(day: string, time: string, timeZone: string): Date {
  const guess = Date.parse(`${day}T${time}:00.000Z`);
  const offset = (instant: number) => {
    const parts = new Intl.DateTimeFormat("en-US", {
      timeZone,
      hourCycle: "h23",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
    }).formatToParts(instant);
    const value = (type: Intl.DateTimeFormatPartTypes) => Number(parts.find((part) => part.type === type)?.value);
    return Date.UTC(value("year"), value("month") - 1, value("day"), value("hour"), value("minute")) - instant;
  };
  const first = guess - offset(guess);
  return new Date(guess - offset(first));
}

/** Forty routines spread over the working day, so a week cell has more runs than it shows. */
const MANY_ROUTINES: StoryRoutine[] = Array.from({ length: 40 }, (_, index) => {
  const hour = 7 + (index % 11);
  const minute = (index * 15) % 60;
  const agent = STORY_AGENTS[index % STORY_AGENTS.length];
  const names = ["Inbox sweep", "Price check", "Lead scoring", "Paper scan", "Status digest", "Backup check"];
  return routine(
    `bulk-${index}`,
    `${names[index % names.length]} ${index + 1}`,
    [agent],
    index % 3 === 0
      ? { kind: "weekdays", time: `${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}` }
      : { kind: "daily", time: `${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}` },
    { paused: index % 9 === 4, failedOn: index % 7 === 2 ? ["2026-10-13"] : [] },
  );
});

const meta = {
  title: "Routines/Calendar",
  component: RoutineCalendar,
  render: (args) => (
    <main style={{ width: "min(1400px, 100vw)", padding: "var(--openbot-space-6)" }}>
      <RoutineCalendar {...args} />
    </main>
  ),
  args: {
    routines: ROUTINES,
    runs: runsFor(ROUTINES, NOW, WARSAW),
    agents: AGENTS,
    now: NOW,
    timeZone: WARSAW,
    state: "ready",
    onOpenRoutine: fn(),
    onOpenAgent: fn(),
    onRangeChange: fn(),
    onRetry: fn(),
    onCreateRoutine: fn(),
  },
  argTypes: {
    state: { control: "inline-radio", options: ["ready", "loading", "error"] },
    initialView: { control: "inline-radio", options: ["week", "day"] },
  },
  parameters: { layout: "fullscreen", a11y: { test: "error" } },
} satisfies Meta<typeof RoutineCalendar>;

export default meta;
type Story = StoryObj<typeof meta>;

/** Past runs show their outcome. Weekly planning is paused, so its Friday run is a dashed ghost. */
export const Week: Story = {};

/** One day by the hour. Each run opens its routine; each avatar opens its agent. */
export const Day: Story = { args: { initialView: "day" } };

/**
 * The clocks in Warsaw go back on Sunday. The morning brief stays at 7:00 AM on both sides of
 * the change, although its UTC time moves by one hour.
 */
export const ClockChangeWeek: Story = {
  args: { now: NOW_BEFORE_CLOCK_CHANGE, runs: runsFor(ROUTINES, NOW_BEFORE_CLOCK_CHANGE, WARSAW) },
};

/** A viewer in New York sees the Warsaw routines at New York times, on New York days. */
export const OtherTimeZone: Story = { args: { timeZone: "America/New_York" } };

/** Forty routines: a day shows four runs and a count; the count opens the day view. */
export const ManyRoutines: Story = {
  args: { routines: MANY_ROUTINES, runs: runsFor(MANY_ROUTINES, NOW, WARSAW) },
};

export const ManyRoutinesDay: Story = {
  args: { ...ManyRoutines.args, initialView: "day" },
};

/** Routines exist, but none of them runs in this range. */
export const NoRunsThisWeek: Story = { args: { runs: [] } };

export const Empty: Story = { args: { routines: [], runs: [] } };

export const Loading: Story = { args: { state: "loading" } };

export const LoadError: Story = { args: { state: "error" } };

/** A phone or a side panel: the week becomes a list of days, and the next runs move below it. */
export const Narrow: Story = {
  render: (args) => (
    <main style={{ width: "390px", padding: "var(--openbot-space-4)" }}>
      <RoutineCalendar {...args} />
    </main>
  ),
};
