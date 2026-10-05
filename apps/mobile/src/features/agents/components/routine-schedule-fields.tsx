import { Host, Picker, Switch } from "@expo/ui";
import { INPUT_LIMITS } from "@openbot/contracts/input-limits";
import type { MobileTextKey } from "@openbot/i18n/mobile";
import {
  ROUTINE_EVERY_DAY,
  ROUTINE_EVERY_HOURS,
  ROUTINE_SAVED_DRAFT_KIND_VALUES,
  ROUTINE_WORKDAYS,
  type RoutineDraftKind,
  type RoutineDraftProblem,
  type RoutineScheduleDraft,
  routineDraftProblemCode,
  routineHourlyMinute,
  routineYearlyDaysInMonth,
  sameRoutineDays,
  switchDraftKind,
  toggleRoutineDay,
} from "@openbot/team-client/routine-schedule-draft";
import { Typography } from "heroui-native";
import type { ReactNode } from "react";
import { Pressable, View } from "react-native";
import { useUniwind } from "uniwind";
import { SettingsRow, SettingsSection } from "@/features/settings/components/settings-content";
import { SheetFormField } from "@/shared/components/sheet-form-field";
import { haptics } from "@/shared/lib/haptics";
import { useText } from "@/shared/lib/text";
import { RoutineTimePicker } from "./routine-schedule-time";

const KIND_LABEL = {
  once: "mobile.agent.record.repeat.once",
  hourly: "mobile.agent.record.repeat.hourly",
  daily: "mobile.agent.record.repeat.daily",
  weekly: "mobile.agent.record.repeat.weekly",
  monthly: "mobile.agent.record.repeat.monthly",
  yearly: "mobile.agent.record.repeat.yearly",
  custom: "mobile.agent.record.repeat.custom",
} as const satisfies Record<RoutineDraftKind, MobileTextKey>;

const PROBLEM_TEXT = {
  once: "mobile.agent.record.problem.once",
  endBeforeStart: "mobile.agent.record.problem.endBeforeStart",
  invalidDate: "mobile.agent.record.problem.invalidDate",
  cronRequired: "mobile.agent.record.problem.cronRequired",
  cronTooLong: "mobile.agent.record.problem.cronTooLong",
} as const satisfies Record<RoutineDraftProblem, MobileTextKey>;

/** The week as a person reads it, from Monday. 0 is Sunday, as in the saved schedule. */
const WEEK_ORDER = [1, 2, 3, 4, 5, 6, 0];
const MONTHS = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12];
const DEFAULT_WINDOW = { start: "09:00", end: "18:00" };

/**
 * The schedule as the desktop asks for it: how often, on which days, and at what time. A cron
 * expression is the last choice of the frequency, for a schedule the other choices cannot say.
 */
export function RoutineScheduleFields({
  draft,
  disabled,
  footer,
  onChange,
}: {
  draft: RoutineScheduleDraft;
  disabled: boolean;
  /** Rows after the schedule, in the same group, such as the time zone. */
  footer?: ReactNode;
  onChange: (draft: RoutineScheduleDraft) => void;
}) {
  const { t, format } = useText();
  const { theme } = useUniwind();
  const colorScheme = theme === "dark" ? "dark" : "light";
  const problem = routineDraftProblemCode(draft);
  const weekdayName = (day: number) => format.date(Date.UTC(2023, 0, 1 + day), { weekday: "long", timeZone: "UTC" });

  const pickerRow = <T extends string | number>(
    label: MobileTextKey,
    value: T,
    options: { value: T; label: string }[],
    change: (value: T) => void,
  ) => (
    <SettingsRow
      trailing={
        <Host matchContents colorScheme={colorScheme}>
          <Picker selectedValue={value} enabled={!disabled} onValueChange={(next: T) => change(next)}>
            {options.map((option) => (
              <Picker.Item key={option.value} label={option.label} value={option.value} />
            ))}
          </Picker>
        </Host>
      }
    >
      <Typography.Paragraph>{t(label)}</Typography.Paragraph>
    </SettingsRow>
  );

  const timeRow = (time: string, change: (time: string) => void, label?: string) => (
    <RoutineTimePicker time={time} label={label} disabled={disabled} onChange={change} />
  );

  const daysRow = (days: number[], change: (days: number[]) => void) => (
    <RoutineDayChips days={days} disabled={disabled} onChange={change} />
  );

  let fields: ReactNode = null;
  let hint: string | null = null;
  switch (draft.kind) {
    case "hourly":
      fields = (
        <>
          {pickerRow(
            "mobile.agent.record.every",
            draft.everyHours,
            ROUTINE_EVERY_HOURS.map((hours) => ({
              value: hours,
              label: t("mobile.agent.record.everyHours", { count: hours }),
            })),
            (everyHours) => onChange({ ...draft, everyHours }),
          )}
          {daysRow(draft.days, (days) => onChange({ ...draft, days }))}
          <SettingsRow
            trailing={
              <Host matchContents colorScheme={colorScheme}>
                <Switch
                  label={t("mobile.agent.record.allDay")}
                  value={draft.window === null}
                  disabled={disabled}
                  onValueChange={(allDay) =>
                    onChange(
                      allDay
                        ? { kind: "hourly", everyHours: draft.everyHours, days: draft.days, window: null }
                        : { kind: "hourly", everyHours: draft.everyHours, days: draft.days, window: DEFAULT_WINDOW },
                    )
                  }
                />
              </Host>
            }
          >
            <Typography.Paragraph>{t("mobile.agent.record.allDay")}</Typography.Paragraph>
          </SettingsRow>
          {draft.window
            ? (() => {
                const window = draft.window;
                return (
                  <>
                    {timeRow(
                      window.start,
                      (start) => onChange({ ...draft, window: { ...window, start } }),
                      t("mobile.agent.record.from"),
                    )}
                    {timeRow(
                      window.end,
                      (end) => onChange({ ...draft, window: { ...window, end } }),
                      t("mobile.agent.record.to"),
                    )}
                  </>
                );
              })()
            : pickerRow(
                "mobile.agent.record.minute",
                routineHourlyMinute(draft),
                Array.from({ length: 60 }, (_, minute) => ({
                  value: minute,
                  label: `:${String(minute).padStart(2, "0")}`,
                })),
                (minute) => onChange({ ...draft, minute }),
              )}
        </>
      );
      break;
    case "daily":
      fields = (
        <>
          {daysRow(draft.days, (days) => onChange({ ...draft, days }))}
          {timeRow(draft.time, (time) => onChange({ ...draft, time }))}
        </>
      );
      break;
    case "weekly":
      fields = (
        <>
          {pickerRow(
            "mobile.agent.record.day",
            draft.weekday,
            WEEK_ORDER.map((day) => ({ value: day, label: weekdayName(day) })),
            (weekday) => onChange({ ...draft, weekday }),
          )}
          {timeRow(draft.time, (time) => onChange({ ...draft, time }))}
        </>
      );
      break;
    case "monthly":
      fields = (
        <>
          {pickerRow(
            "mobile.agent.record.dayOfMonth",
            draft.day,
            Array.from({ length: 31 }, (_, index) => ({ value: index + 1, label: String(index + 1) })),
            (day) => onChange({ ...draft, day }),
          )}
          {timeRow(draft.time, (time) => onChange({ ...draft, time }))}
        </>
      );
      if (draft.day > 28) hint = t("mobile.agent.record.lateMonthDay", { day: draft.day });
      break;
    case "yearly":
      fields = (
        <>
          {pickerRow(
            "mobile.agent.record.month",
            draft.month,
            MONTHS.map((month) => ({
              value: month,
              label: format.date(Date.UTC(2024, month - 1, 1), { month: "long", timeZone: "UTC" }),
            })),
            (month) => onChange({ ...draft, month, day: Math.min(draft.day, routineYearlyDaysInMonth(month)) }),
          )}
          {pickerRow(
            "mobile.agent.record.dayOfMonth",
            draft.day,
            Array.from({ length: routineYearlyDaysInMonth(draft.month) }, (_, index) => ({
              value: index + 1,
              label: String(index + 1),
            })),
            (day) => onChange({ ...draft, day }),
          )}
          {timeRow(draft.time, (time) => onChange({ ...draft, time }))}
        </>
      );
      break;
    case "custom":
      fields = (
        <View className="p-4">
          <SheetFormField
            appearance="soft"
            label={t("mobile.agent.record.cronExpression")}
            placeholder="0 9 * * 1-5"
            value={draft.expression}
            maxLength={INPUT_LIMITS.routineCron}
            editable={!disabled}
            onChangeText={(expression) => onChange({ kind: "custom", expression })}
          />
        </View>
      );
      hint = t("mobile.agent.record.cronHint");
      break;
    case "once":
      break;
  }

  return (
    <SettingsSection
      title={t("mobile.agent.record.schedule")}
      footer={problem && problem !== "cronRequired" ? t(PROBLEM_TEXT[problem]) : hint}
    >
      {pickerRow(
        "mobile.agent.record.repeat",
        draft.kind,
        ROUTINE_SAVED_DRAFT_KIND_VALUES.map((kind) => ({ value: kind, label: t(KIND_LABEL[kind]) })),
        (kind) => onChange(switchDraftKind(draft, kind, new Date())),
      )}
      {fields}
      {footer}
    </SettingsSection>
  );
}

/** The days of a run: seven toggles from Monday, with the name of a common set beside the label. */
function RoutineDayChips({
  days,
  disabled,
  onChange,
}: {
  days: number[];
  disabled: boolean;
  onChange: (days: number[]) => void;
}) {
  const { t, format } = useText();
  const named = sameRoutineDays(days, ROUTINE_EVERY_DAY)
    ? t("mobile.agent.record.days.everyDay")
    : sameRoutineDays(days, ROUTINE_WORKDAYS)
      ? t("mobile.agent.record.days.weekdays")
      : sameRoutineDays(days, [0, 6])
        ? t("mobile.agent.record.days.weekends")
        : null;
  return (
    <View className="gap-3 px-4 py-3">
      <View className="flex-row items-center justify-between">
        <Typography.Paragraph>{t("mobile.agent.record.days")}</Typography.Paragraph>
        {named ? (
          <Typography.Paragraph type="body-sm" className="text-grouped-secondary">
            {named}
          </Typography.Paragraph>
        ) : null}
      </View>
      <View className="flex-row justify-between">
        {WEEK_ORDER.map((day) => {
          const selected = days.includes(day);
          const date = Date.UTC(2023, 0, 1 + day);
          return (
            <Pressable
              key={day}
              accessibilityRole="checkbox"
              accessibilityState={{ checked: selected, disabled }}
              accessibilityLabel={format.date(date, { weekday: "long", timeZone: "UTC" })}
              disabled={disabled}
              className={`size-10 items-center justify-center rounded-full ${selected ? "bg-action" : "bg-control"}`}
              style={{ opacity: disabled ? 0.45 : 1 }}
              onPress={() => {
                void haptics.selection();
                onChange(toggleRoutineDay(days, day));
              }}
            >
              <Typography
                type="body-sm"
                weight="semibold"
                className={selected ? "text-action-foreground" : "text-grouped-secondary"}
              >
                {format.date(date, { weekday: "narrow", timeZone: "UTC" })}
              </Typography>
            </Pressable>
          );
        })}
      </View>
    </View>
  );
}
