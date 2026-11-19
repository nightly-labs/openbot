import type { RoutineSchedule } from "@openbot/contracts/ipc";
import {
  RoutineCalendar,
  type RoutineCalendarAgent,
  type RoutineCalendarRoutine,
  type RoutineCalendarRun,
} from "@openbot/ui/features/conversation/RoutineCalendar";
import type {
  RoutineCalendarCreate,
  RoutineCreateFields,
} from "@openbot/ui/features/conversation/RoutineCalendarCreateCard";
import { type ComponentProps, createSignal } from "solid-js";
import { fn } from "storybook/test";
import type { Meta, StoryObj } from "storybook-solidjs-vite";
import { STORY_AGENTS } from "./fixtures";

const WARSAW = "Europe/Warsaw";
const [chief, research, sales] = STORY_AGENTS;
const AGENTS: RoutineCalendarAgent[] = STORY_AGENTS;

interface StoryRoutine extends RoutineCalendarRoutine {
  paused?: boolean;
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

const NOW = new Date("2026-10-14T08:30:00.000Z");
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
    case "once":
      return schedule.date === day ? schedule.time : null;
    default:
      return null;
  }
}

function addDays(day: string, amount: number): string {
  const date = new Date(`${day}T12:00:00.000Z`);
  date.setUTCDate(date.getUTCDate() + amount);
  return date.toISOString().slice(0, 10);
}

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
    initialView: { control: "inline-radio", options: ["month", "week", "day"] },
  },
  parameters: { layout: "fullscreen", a11y: { test: "error" } },
} satisfies Meta<typeof RoutineCalendar>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Week: Story = {};

export const Day: Story = { args: { initialView: "day" } };

export const Month: Story = { args: { initialView: "month" } };

export const ClockChangeWeek: Story = {
  args: { now: NOW_BEFORE_CLOCK_CHANGE, runs: runsFor(ROUTINES, NOW_BEFORE_CLOCK_CHANGE, WARSAW) },
};

export const OtherTimeZone: Story = { args: { timeZone: "America/New_York" } };

export const ManyRoutines: Story = {
  args: { routines: MANY_ROUTINES, runs: runsFor(MANY_ROUTINES, NOW, WARSAW) },
};

export const ManyRoutinesDay: Story = {
  args: { ...ManyRoutines.args, initialView: "day" },
};

export const ManyRoutinesMonth: Story = {
  args: { ...ManyRoutines.args, initialView: "month" },
};

export const NoRunsThisWeek: Story = { args: { runs: [] } };

export const Empty: Story = { args: { routines: [], runs: [] } };

export const EmptyOneAgent: Story = { args: { routines: [], runs: [], agents: STORY_AGENTS.slice(0, 1) } };

export const Loading: Story = { args: { state: "loading" } };

export const LoadError: Story = { args: { state: "error" } };

export const Narrow: Story = {
  render: (args) => (
    <main style={{ width: "390px", padding: "var(--openbot-space-4)" }}>
      <RoutineCalendar {...args} />
    </main>
  ),
};

export const NarrowMonth: Story = { ...Narrow, args: { initialView: "month" } };

export const EmptyNarrow: Story = { ...Narrow, args: { routines: [], runs: [] } };

const ALL_FIELDS: RoutineCreateFields = { onceSchedule: true, limitPolicy: true, missedPolicy: true, runIn: true };

function CreatingCalendar(props: ComponentProps<typeof RoutineCalendar> & { fields: RoutineCreateFields }) {
  const [routines, setRoutines] = createSignal<StoryRoutine[]>(ROUTINES);
  const create: RoutineCalendarCreate = {
    fields: props.fields,
    save: async (routine) => {
      setRoutines((items) => [
        ...items,
        { id: `new-${items.length}`, name: routine.name, agentIds: [routine.agentId], schedule: routine.schedule },
      ]);
    },
  };
  return (
    <main style={{ width: "min(1400px, 100vw)", padding: "var(--openbot-space-6)" }}>
      <RoutineCalendar
        {...props}
        routines={routines()}
        runs={runsFor(routines(), props.now, props.timeZone)}
        create={create}
      />
    </main>
  );
}

export const CreateFromDay: Story = {
  render: (args) => <CreatingCalendar {...args} fields={ALL_FIELDS} />,
};

export const CreateFromHour: Story = { ...CreateFromDay, args: { initialView: "day" } };

export const CreateOnOlderHost: Story = {
  render: (args) => (
    <CreatingCalendar
      {...args}
      fields={{ onceSchedule: false, limitPolicy: false, missedPolicy: false, runIn: false }}
    />
  ),
};
