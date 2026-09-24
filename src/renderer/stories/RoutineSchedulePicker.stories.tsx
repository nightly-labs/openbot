import { Text } from "@openbot/ui";
import { RoutineSchedulePicker } from "@openbot/ui/features/conversation/RoutineSchedulePicker";
import {
  ROUTINE_EVERY_DAY,
  ROUTINE_WORKDAYS,
  type RoutineScheduleDraft,
  routineDraftSummary,
} from "@openbot/ui/features/conversation/routine-schedule-draft";
import { createSignal } from "solid-js";
import { expect, fn, waitFor, within } from "storybook/test";
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
  play: async ({ canvas }) => {
    await expect(canvas.getByText("Skipped in months without day 31.")).toBeVisible();
  },
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

export const FrequencyMenuOpen: Story = {
  play: async ({ canvas, canvasElement, userEvent }) => {
    await userEvent.click(canvas.getByRole("button", { name: /^Frequency/ }));
    const body = within(canvasElement.ownerDocument.body);
    await userEvent.click(await body.findByRole("option", { name: "Weekly" }));
    // A change of frequency keeps the time already set.
    await expect(canvas.getByRole("button", { name: "Time: 7:30 AM" })).toBeVisible();
    await expect(canvas.getByRole("button", { name: "Days: Sun" })).toBeVisible();
    await userEvent.click(canvas.getByRole("button", { name: /^Frequency/ }));
    await waitFor(async () => expect(await body.findByRole("option", { name: "Custom" })).toBeVisible());
  },
};

export const WeekdaysOpen: Story = {
  args: { schedule: { kind: "daily", days: ROUTINE_EVERY_DAY, time: "07:30" } },
  play: async ({ canvas, canvasElement, userEvent }) => {
    await userEvent.click(canvas.getByRole("button", { name: "Days: Every day" }));
    const body = within(canvasElement.ownerDocument.body);
    await userEvent.click(await body.findByRole("button", { name: "Sunday" }));
    await userEvent.click(body.getByRole("button", { name: "Saturday" }));
    await expect(body.getByRole("button", { name: "Monday" })).toHaveAttribute("aria-pressed", "true");
    await expect(body.getByRole("button", { name: "Sunday" })).toHaveAttribute("aria-pressed", "false");
    // The open popover is modal and hides the row, so the chip is read after it closes.
    await userEvent.keyboard("{Escape}");
    await waitFor(() => expect(canvas.getByRole("button", { name: "Days: Weekdays" })).toHaveFocus());
  },
};

export const WeeklyDayOpen: Story = {
  args: { schedule: { kind: "weekly", weekday: 4, time: "08:20" } },
  play: async ({ canvas, canvasElement, userEvent }) => {
    await userEvent.click(canvas.getByRole("button", { name: "Days: Thu" }));
    const body = within(canvasElement.ownerDocument.body);
    await expect(await body.findByRole("radio", { name: "Thursday" })).toBeChecked();
  },
};

export const TimeFieldOpen: Story = {
  args: { schedule: { kind: "weekly", weekday: 4, time: "08:20" } },
  play: async ({ canvas, canvasElement, userEvent }) => {
    await userEvent.click(canvas.getByRole("button", { name: "Time: 8:20 AM" }));
    const body = within(canvasElement.ownerDocument.body);
    const hour = await body.findByRole("textbox", { name: "Time hour" });
    await expect(hour).toHaveValue("8");
    await expect(body.getByRole("textbox", { name: "Time minute" })).toHaveValue("20");
    await userEvent.click(body.getByRole("radio", { name: "PM" }));
    await userEvent.keyboard("{Escape}");
    await waitFor(() => expect(canvas.getByRole("button", { name: "Time: 8:20 PM" })).toHaveFocus());
  },
};

export const HoursWindowOpen: Story = {
  args: {
    schedule: { kind: "hourly", everyHours: 1, days: ROUTINE_EVERY_DAY, window: { start: "09:00", end: "18:00" } },
  },
  play: async ({ canvas, canvasElement, userEvent }) => {
    await userEvent.click(canvas.getByRole("button", { name: "Hours: 9 AM–6 PM" }));
    const body = within(canvasElement.ownerDocument.body);
    await expect(await body.findByRole("radio", { name: /Between hours/ })).toBeChecked();
    await waitFor(() => expect(body.getByText("10 times a day")).toBeVisible());
    await userEvent.click(body.getByRole("button", { name: /^Repeat/ }));
    await userEvent.click(await body.findByRole("option", { name: "every 2 hours" }));
    await waitFor(() => expect(body.getByText("5 times a day")).toBeVisible());
    await userEvent.keyboard("{Escape}");
    // The step moves to the frequency chip, so the row does not say "hourly" twice.
    await expect(canvas.getByRole("button", { name: /^Frequency/ })).toHaveTextContent("Every 2h");
    await expect(canvas.getByRole("button", { name: "Hours: 9 AM–6 PM" })).toBeVisible();
  },
};

export const MonthlyDayOpen: Story = {
  args: { schedule: { kind: "monthly", day: 24, time: "08:20" } },
  play: async ({ canvas, canvasElement, userEvent }) => {
    await userEvent.click(canvas.getByRole("button", { name: /^Day of month/ }));
    const body = within(canvasElement.ownerDocument.body);
    await expect(await body.findByRole("option", { name: "Day 24" })).toHaveAttribute("aria-selected", "true");
  },
};

export const OnceDateOpen: Story = {
  args: { schedule: { kind: "once", date: "2026-09-24", time: "08:20" } },
  play: async ({ canvas, canvasElement, userEvent }) => {
    await userEvent.click(canvas.getByRole("button", { name: "Date: Thu, Sep 24" }));
    const body = within(canvasElement.ownerDocument.body);
    await expect(await body.findByRole("button", { name: "Wednesday, September 23, 2026" })).toBeDisabled();
    await expect(body.getByRole("button", { name: "Previous month" })).toBeDisabled();
    await userEvent.click(body.getByRole("button", { name: "Tuesday, September 29, 2026" }));
    await expect(await canvas.findByRole("button", { name: "Date: Tue, Sep 29" })).toBeVisible();
  },
};
