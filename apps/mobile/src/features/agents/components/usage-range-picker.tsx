import { type AgentAnalyticsInput, analyticsRange } from "@openbot/contracts/ipc";
import { useState } from "react";
import { SettingsSection } from "@/features/settings/components/settings-content";
import { useText } from "@/shared/lib/text";
import { UsageDateRow } from "./usage-date-row";
import { UsageSegments } from "./usage-segments";

export type UsageRange = Omit<AgentAnalyticsInput, "agentId">;

const PRESETS = [7, 30, 90, 365] as const;
/** The host accepts at most 367 calendar days, so the end is at most 366 days after the start. */
const MAX_SPAN_DAYS = 366;

/** The last `days` calendar days in the phone's time zone, today included. */
export function lastUsageDays(days = 30): UsageRange {
  const { startDate, endDate, timeZone } = analyticsRange("", days);
  return { startDate, endDate, timeZone };
}

function addDays(date: string, days: number): string {
  const value = new Date(`${date}T12:00:00Z`);
  value.setUTCDate(value.getUTCDate() + days);
  return value.toISOString().slice(0, 10);
}

function clamp(date: string, min: string, max: string): string {
  return date < min ? min : date > max ? max : date;
}

/**
 * The preset periods and a custom range of an agent or server usage report. A custom date
 * applies at once. A date that makes the range too long or inverted moves the other date,
 * so each date can be set in any order.
 */
export function UsageRangePicker({ range, onChange }: { range: UsageRange; onChange: (range: UsageRange) => void }) {
  const { t } = useText();
  const [period, setPeriod] = useState<(typeof PRESETS)[number] | "custom">(30);
  const today = lastUsageDays(1).endDate;
  const options = [
    ...PRESETS.map((days) => ({
      value: String(days),
      label: days === 365 ? t("mobile.agent.usage.oneYear") : t("mobile.agent.usage.days", { count: days }),
    })),
    { value: "custom", label: t("mobile.agent.usage.custom") },
  ];
  function selectPeriod(value: string) {
    const days = PRESETS.find((preset) => String(preset) === value);
    setPeriod(days ?? "custom");
    if (days) onChange(lastUsageDays(days));
  }
  return (
    <>
      <UsageSegments options={options} value={String(period)} onChange={selectPeriod} />
      {period === "custom" ? (
        <SettingsSection>
          <UsageDateRow
            label={t("mobile.agent.usage.startDate")}
            date={range.startDate}
            max={today}
            onChange={(startDate) =>
              onChange({
                ...range,
                startDate,
                endDate: clamp(range.endDate, startDate, clamp(addDays(startDate, MAX_SPAN_DAYS), startDate, today)),
              })
            }
          />
          <UsageDateRow
            label={t("mobile.agent.usage.endDate")}
            date={range.endDate}
            max={today}
            onChange={(endDate) =>
              onChange({
                ...range,
                startDate: clamp(range.startDate, addDays(endDate, -MAX_SPAN_DAYS), endDate),
                endDate,
              })
            }
          />
        </SettingsSection>
      ) : null}
    </>
  );
}
