import { Text } from "@openbot/ui";
import { RoutineSchedulePicker } from "@openbot/ui/features/conversation/RoutineSchedulePicker";
import {
  ROUTINE_EVERY_DAY,
  ROUTINE_WORKDAYS,
  type RoutineScheduleDraft,
  routineDraftSummary,
} from "@openbot/ui/features/conversation/routine-schedule-draft";
import { createSignal } from "solid-js";
import { fn } from "storybook/test";
import type { Meta, StoryObj } from "storybook-solidjs-vite";

/*
 * The routine schedule as one row of chips, after grok.com/automations. These stories are the
 * design step: the row edits a UI draft, not the saved `RoutineSchedule`, so it is not wired
 * into the routine settings yet.
 */

/** A fixed day, so the calendar and the default dates do not move with the clock. */
const STORY_TODAY = new Date(2026, 8, 24, 10, 0);

interface PickerArgs {
  schedule: RoutineScheduleDraft;
  width: "panel" | "wide";
  disabled: boolean;
  onChange: (schedule: RoutineScheduleDraft) => void;
}

function PickerStage(props: PickerArgs) {
  // Derived, so a change in the Controls panel resets the row.
  const [schedule, setSchedule] = createSignal(() => props.schedule);
  return (
    <main
      style={{
        display: "grid",
        gap: "var(--openbot-space-3)",
        // 296px is the settings panel's default width.
        width: props.width === "panel" ? "296px" : "640px",
        padding: "var(--openbot-space-4)",
        background: "var(--openbot-bg-canvas)",
      }}
    >
      <RoutineSchedulePicker
        schedule={schedule()}
        today={STORY_TODAY}
        disabled={props.disabled}
        onChange={(next) => {
          setSchedule(next);
          props.onChange(next);
        }}
      />
      <Text variant="caption" tone="muted" aria-live="polite">
        {routineDraftSummary(schedule())}
      </Text>
    </main>
  );
}

const meta = {
  title: "Routines/Schedule picker",
  render: (args) => <PickerStage {...args} />,
  args: {
    schedule: { kind: "daily", days: ROUTINE_EVERY_DAY, time: "07:30" },
    width: "panel",
    disabled: false,
    onChange: fn(),
  },
  argTypes: {
    width: { control: "inline-radio", options: ["panel", "wide"] },
    schedule: { control: "object" },
  },
  parameters: { layout: "centered", a11y: { test: "error" } },
} satisfies Meta<PickerArgs>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Once: Story = { args: { schedule: { kind: "once", date: "2026-09-24", time: "08:20" } } };

export const Hourly: Story = {
  args: {
    schedule: { kind: "hourly", everyHours: 1, days: ROUTINE_EVERY_DAY, window: { start: "09:00", end: "18:00" } },
  },
};

export const Daily: Story = {};

export const Weekly: Story = { args: { schedule: { kind: "weekly", weekday: 4, time: "08:20" } } };

export const Monthly: Story = { args: { schedule: { kind: "monthly", day: 24, time: "08:20" } } };

export const MonthlyLateDay: Story = {
  args: { schedule: { kind: "monthly", day: 31, time: "18:00" } },
};

export const Yearly: Story = { args: { schedule: { kind: "yearly", month: 9, day: 24, time: "08:20" } } };

export const Custom: Story = { args: { schedule: { kind: "custom", expression: "*/15 9-17 * * 1-5" } } };

/** The old "Weekdays" kind is a Daily run on Monday to Friday. */
export const WeekdaysFolded: Story = { args: { schedule: { kind: "daily", days: ROUTINE_WORKDAYS, time: "07:00" } } };

/** The old "Interval" kind is an Hourly run every N hours through the whole day. */
export const EveryTwoHours: Story = {
  args: { schedule: { kind: "hourly", everyHours: 2, days: ROUTINE_EVERY_DAY, window: null } },
};

export const Wide: Story = {
  args: {
    width: "wide",
    schedule: { kind: "hourly", everyHours: 1, days: ROUTINE_WORKDAYS, window: { start: "09:00", end: "18:00" } },
  },
};

export const Disabled: Story = { args: { disabled: true, schedule: { kind: "weekly", weekday: 4, time: "08:20" } } };
