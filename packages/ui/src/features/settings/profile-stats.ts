import { analyticsTokens, type ClientAgentSummary, type HostAnalytics } from "@openbot/contracts/ipc";
import { usageProviders } from "../usage/usage-format";

const DAY_MS = 86_400_000;

export interface ProfileDay {
  /** `YYYY-MM-DD` in the report's time zone. */
  date: string;
  /** 0 is Sunday. */
  weekday: number;
  tokens: number;
  messages: number;
}

export interface ProfileStats {
  days: ProfileDay[];
  tokens: number;
  messages: number;
  cost: number | null;
  activeDays: number;
  peak: ProfileDay | null;
  currentStreak: number;
  /** The first day of the current streak. */
  currentStreakStart: string | null;
  longestStreak: number;
  longestStreakDates: { start: string; end: string } | null;
  busiestWeekday: number | null;
  providers: Array<{ provider: string; tokens: number; share: number }>;
  models: Array<{ provider: string; model: string; share: number }>;
  teammates: Array<{ agent: ClientAgentSummary; tokens: number }>;
}

function active(day: ProfileDay): boolean {
  return day.tokens > 0 || day.messages > 0;
}

export type HeatLevel = 0 | 1 | 2 | 3 | 4;

/** A day with messages but no reported tokens is still an active day, so it gets the first level. */
export function heatLevel(day: ProfileDay, max: number): HeatLevel {
  if (day.tokens <= 0 || max <= 0) return day.messages > 0 ? 1 : 0;
  const ratio = day.tokens / max;
  if (ratio <= 0.15) return 1;
  if (ratio <= 0.35) return 2;
  if (ratio <= 0.6) return 3;
  return 4;
}

/** One column of seven slots for each week, Sunday at the top. A slot outside the days is `null`. */
export function heatmapWeeks(days: readonly ProfileDay[]): Array<Array<ProfileDay | null>> {
  const slots: Array<ProfileDay | null> = [...Array.from({ length: days[0]?.weekday ?? 0 }, () => null), ...days];
  while (slots.length % 7) slots.push(null);
  const weeks: Array<Array<ProfileDay | null>> = [];
  for (let index = 0; index < slots.length; index += 7) weeks.push(slots.slice(index, index + 7));
  return weeks;
}

/** The week where each month starts, with the first day of the month in that week. */
export function heatmapMonths(weeks: ReadonlyArray<ReadonlyArray<ProfileDay | null>>) {
  const months: Array<{ week: number; date: string }> = [];
  let previous = "";
  weeks.forEach((week, index) => {
    const first = week.find((day) => day !== null);
    if (!first) return;
    const month = first.date.slice(0, 7);
    if (month === previous) return;
    previous = month;
    // A month that starts late in the first week has no room for its label.
    if (index === 0 && Number(first.date.slice(8)) > 7) return;
    months.push({ week: index, date: first.date });
  });
  return months;
}

/**
 * The Profile tab's view of one host report: every day of the range, the streaks, and the
 * rankings. A teammate that was deleted has usage but no row in `agents`, so the ranking skips it.
 */
export function profileStats(report: HostAnalytics, agents: readonly ClientAgentSummary[]): ProfileStats {
  const byDate = new Map(report.daily.map((day) => [day.date, day]));
  const days: ProfileDay[] = [];
  const end = Date.parse(`${report.endDate}T00:00:00Z`);
  for (let time = Date.parse(`${report.startDate}T00:00:00Z`); time <= end; time += DAY_MS) {
    const date = new Date(time).toISOString().slice(0, 10);
    const day = byDate.get(date);
    days.push({
      date,
      weekday: new Date(time).getUTCDay(),
      tokens: day ? analyticsTokens(day) : 0,
      messages: (day?.userMessages ?? 0) + (day?.assistantMessages ?? 0),
    });
  }

  let longestStreak = 0;
  let longestStreakDates: ProfileStats["longestStreakDates"] = null;
  let run = 0;
  days.forEach((day, index) => {
    run = active(day) ? run + 1 : 0;
    if (run <= longestStreak) return;
    longestStreak = run;
    longestStreakDates = { start: days[index - run + 1]?.date ?? day.date, end: day.date };
  });
  // Today does not break the streak before the user has worked today.
  const today = days.at(-1);
  const counted = today && !active(today) ? days.slice(0, -1) : days;
  let currentStreak = 0;
  for (const day of counted.toReversed()) {
    if (!active(day)) break;
    currentStreak += 1;
  }

  const weekdays = Array.from({ length: 7 }, () => 0);
  for (const day of days) weekdays[day.weekday] = (weekdays[day.weekday] ?? 0) + day.tokens;
  const busiest = Math.max(...weekdays);
  const tokens = analyticsTokens(report.totals);
  const agentById = new Map(agents.map((agent) => [agent.id, agent]));

  return {
    days,
    tokens,
    messages: report.totals.userMessages + report.totals.assistantMessages,
    cost: report.totals.estimatedCostUsd,
    activeDays: days.filter(active).length,
    peak: days.reduce<ProfileDay | null>((best, day) => (day.tokens > (best?.tokens ?? 0) ? day : best), null),
    currentStreak,
    currentStreakStart: currentStreak > 0 ? (counted.at(-currentStreak)?.date ?? null) : null,
    longestStreak,
    longestStreakDates,
    busiestWeekday: busiest > 0 ? weekdays.indexOf(busiest) : null,
    providers: usageProviders(report.models)
      .map((row) => ({ provider: row.provider, tokens: row.tokens, share: tokens > 0 ? row.tokens / tokens : 0 }))
      .sort((a, b) => b.tokens - a.tokens),
    models: [...report.models]
      .sort((a, b) => analyticsTokens(b) - analyticsTokens(a))
      .map((row) => ({
        provider: row.provider,
        model: row.model,
        share: tokens > 0 ? analyticsTokens(row) / tokens : 0,
      })),
    teammates: report.agents
      .flatMap((row) => {
        const agent = agentById.get(row.agentId);
        return agent && analyticsTokens(row) > 0 ? [{ agent, tokens: analyticsTokens(row) }] : [];
      })
      .sort((a, b) => b.tokens - a.tokens),
  };
}
