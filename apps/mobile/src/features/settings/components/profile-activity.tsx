import { agentProviderCliName, isAgentProvider } from "@openbot/contracts/ipc";
import {
  type HeatLevel,
  heatLevel,
  heatmapMonths,
  heatmapWeeks,
  type ProfileDay,
  type ProfileStats,
} from "@openbot/team-client/profile-stats";
import { Button, Typography } from "heroui-native";
import { useMemo, useRef, useState } from "react";
import { type GestureResponderEvent, Pressable, ScrollView, type ScrollViewInstance, View } from "react-native";
import Animated, { cubicBezier, Easing, FadeIn, FadeOut, LayoutAnimationConfig } from "react-native-reanimated";
import { useCSSVariable } from "uniwind";
import { AgentProviderAvatar } from "@/features/agents/components/agent-provider-avatar";
import { UsageBar, UsageLoading, UsageValue } from "@/features/agents/components/usage-motion";
import { SettingsNote, SettingsRow, SettingsSection } from "@/features/settings/components/settings-content";
import type { ProfileActivity as ProfileActivityState } from "@/features/settings/model/use-profile-activity";
import type { MobileAgent } from "@/features/workspace/model/workspace-types";
import { useReducedMotion } from "@/shared/lib/motion";
import { useText } from "@/shared/lib/text";

const CELL = 11;
const GAP = 3;
const STEP = CELL + GAP;
const AVATAR_SIZE = 32;
/** The opacity of each heatmap level; level 0 is the border colour, the others the accent. */
const LEVEL_ALPHA = [1, 0.32, 0.55, 0.78, 1] as const;
const EASING = cubicBezier(0.23, 1, 0.32, 1);
const CELL_MS = 320;
const SECTION_EASING = Easing.bezier(0.23, 1, 0.32, 1);
const SECTION_IN = FadeIn.duration(220).easing(SECTION_EASING);
const SECTION_OUT = FadeOut.duration(160).easing(SECTION_EASING);
/** The value of a tile or a row before the report arrives. */
const NO_VALUE = "–";
/** Keeps the line of a tile detail while the report loads, so the tile does not grow when it arrives. */
const BLANK_LINE = "\u00a0";

/** The days of the range with no activity: the grid that shows while the report loads. */
function emptyDays(range: { startDate: string; endDate: string }): ProfileDay[] {
  const days: ProfileDay[] = [];
  const end = Date.parse(`${range.endDate}T00:00:00Z`);
  for (let time = Date.parse(`${range.startDate}T00:00:00Z`); time <= end; time += 86_400_000)
    days.push({
      date: new Date(time).toISOString().slice(0, 10),
      weekday: new Date(time).getUTCDay(),
      tokens: 0,
      messages: 0,
    });
  return days;
}

/** A report with no activity. The screen keeps its layout and the real values move into it. */
function placeholderStats(range: { startDate: string; endDate: string }): ProfileStats<MobileAgent> {
  return {
    days: emptyDays(range),
    tokens: 0,
    messages: 0,
    cost: null,
    activeDays: 0,
    peak: null,
    currentStreak: 0,
    currentStreakStart: null,
    longestStreak: 0,
    longestStreakDates: null,
    busiestWeekday: null,
    providers: [],
    models: [],
    teammates: [],
  };
}

const providerName = (value: string) => (isAgentProvider(value) ? agentProviderCliName(value) : value);

/** A day of the report as the user reads it: the date is in the report's zone, not in UTC. */
function reportDate(date: string): number {
  return Date.parse(`${date}T00:00:00Z`);
}

function useProfileDates() {
  const { t, format } = useText();
  const long = (date: string) =>
    format.date(reportDate(date), { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" });
  const short = (date: string) => format.date(reportDate(date), { month: "short", day: "numeric", timeZone: "UTC" });
  return {
    long,
    short,
    month: (date: string) => format.date(reportDate(date), { month: "short", timeZone: "UTC" }),
    range: (start: string, end: string) =>
      start === end
        ? long(end)
        : t("mobile.settings.profile.tile.range", {
            start: start.slice(0, 4) === end.slice(0, 4) ? short(start) : long(start),
            end: long(end),
          }),
    // 1 January 2023 is a Sunday, so the date of each weekday is that day plus its number.
    weekday: (weekday: number) => format.date(Date.UTC(2023, 0, 1 + weekday), { weekday: "long", timeZone: "UTC" }),
  };
}

/** A day of the grid. When the report arrives, the day fades to its level. */
function HeatCell({ level, color, empty }: { level: HeatLevel; color: string; empty: string }) {
  const reducedMotion = useReducedMotion();
  return (
    <Animated.View
      style={{
        width: CELL,
        height: CELL,
        borderRadius: 3,
        backgroundColor: level === 0 ? empty : color,
        opacity: LEVEL_ALPHA[level],
        transitionProperty: ["backgroundColor", "opacity"],
        transitionDuration: reducedMotion ? 0 : CELL_MS,
        transitionTimingFunction: EASING,
      }}
    />
  );
}

/**
 * A year of days: one column for each week, Sunday at the top. The grid scrolls sideways and opens
 * on the current week. A tap on a day shows its date and tokens under the grid.
 */
function ProfileHeatmap({
  days,
  label,
  summary,
  loading,
}: {
  days: ProfileDay[];
  label: string;
  summary: string;
  loading: boolean;
}) {
  const { t, format } = useText();
  const dates = useProfileDates();
  const accent = String(useCSSVariable("--openbot-accent"));
  const empty = String(useCSSVariable("--openbot-border-grouped"));
  const scroll = useRef<ScrollViewInstance>(null);
  const [selected, setSelected] = useState<ProfileDay | null>(null);
  const model = useMemo(() => {
    const weeks = heatmapWeeks(days);
    const max = Math.max(0, ...days.map((day) => day.tokens));
    return {
      // A week keeps the date of its first day as its key, and an empty slot its place after that date.
      columns: weeks.map((week) => {
        const first = week.find((day) => day !== null)?.date ?? "";
        return {
          key: first,
          cells: week.map((day, row) => ({
            key: day?.date ?? `${first}:${row}`,
            day,
            level: day ? heatLevel(day, max) : 0,
          })),
        };
      }),
      months: heatmapMonths(weeks),
    };
  }, [days]);

  function selectDay(event: GestureResponderEvent) {
    const { locationX, locationY } = event.nativeEvent;
    const day = model.columns[Math.floor(locationX / STEP)]?.cells[Math.floor(locationY / STEP)]?.day;
    setSelected(day && day.date !== selected?.date ? day : null);
  }

  return (
    <View className="gap-3 p-4">
      <ScrollView
        ref={scroll}
        horizontal
        showsHorizontalScrollIndicator={false}
        onContentSizeChange={() => scroll.current?.scrollToEnd({ animated: false })}
      >
        <View className="gap-1.5">
          <View style={{ height: 14 }} accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
            {model.months.map((month) => (
              <Typography
                key={month.week}
                type="body-xs"
                className="absolute text-grouped-secondary"
                style={{ left: month.week * STEP, fontSize: 10, lineHeight: 14 }}
              >
                {dates.month(month.date)}
              </Typography>
            ))}
          </View>
          <Pressable accessibilityRole="image" accessibilityLabel={label} disabled={loading} onPress={selectDay}>
            <View className="flex-row" style={{ gap: GAP }} pointerEvents="none">
              {model.columns.map((column) => (
                <View key={column.key} style={{ gap: GAP }}>
                  {column.cells.map((cell) =>
                    cell.day ? (
                      <View
                        key={cell.key}
                        style={
                          selected?.date === cell.day.date
                            ? { borderRadius: 4, borderWidth: 1.5, borderColor: accent, margin: -2.5, padding: 1 }
                            : undefined
                        }
                      >
                        <HeatCell level={cell.level} color={accent} empty={empty} />
                      </View>
                    ) : (
                      <View key={cell.key} style={{ width: CELL, height: CELL }} />
                    ),
                  )}
                </View>
              ))}
            </View>
          </Pressable>
        </View>
      </ScrollView>
      <View className="flex-row items-center justify-between gap-3">
        <Typography type="body-xs" className="min-w-0 shrink text-grouped-secondary" numberOfLines={1}>
          {selected && !loading
            ? `${dates.long(selected.date)} · ${t("mobile.settings.profile.activity.dayTokens", { tokens: format.compact(selected.tokens) })}`
            : summary}
        </Typography>
        <View
          className="flex-row items-center gap-1"
          accessibilityElementsHidden
          importantForAccessibility="no-hide-descendants"
        >
          <Typography type="body-xs" className="text-grouped-secondary">
            {t("mobile.settings.profile.activity.less")}
          </Typography>
          {([0, 1, 2, 3, 4] as const).map((level) => (
            <HeatCell key={level} level={level} color={accent} empty={empty} />
          ))}
          <Typography type="body-xs" className="text-grouped-secondary">
            {t("mobile.settings.profile.activity.more")}
          </Typography>
        </View>
      </View>
    </View>
  );
}

function ProfileTiles({ stats, loading }: { stats: ProfileStats<MobileAgent>; loading: boolean }) {
  const { t, format } = useText();
  const dates = useProfileDates();
  const none = t("mobile.settings.profile.tile.none");
  const days = (count: number) => t("mobile.settings.profile.tile.days", { count });
  const loaded = [
    {
      label: t("mobile.settings.profile.tile.tokens"),
      value: format.compact(stats.tokens),
      detail: t("mobile.settings.profile.tile.pastYear"),
    },
    {
      label: t("mobile.settings.profile.tile.peakDay"),
      value: stats.peak ? format.compact(stats.peak.tokens) : "–",
      detail: stats.peak ? dates.long(stats.peak.date) : none,
    },
    {
      label: t("mobile.settings.profile.tile.messages"),
      value: format.compact(stats.messages),
      detail: t("mobile.settings.profile.tile.pastYear"),
    },
    {
      label: t("mobile.settings.profile.tile.currentStreak"),
      value: days(stats.currentStreak),
      detail: stats.currentStreakStart
        ? t("mobile.settings.profile.tile.since", { date: dates.short(stats.currentStreakStart) })
        : none,
    },
    {
      label: t("mobile.settings.profile.tile.longestStreak"),
      value: days(stats.longestStreak),
      detail: stats.longestStreakDates
        ? dates.range(stats.longestStreakDates.start, stats.longestStreakDates.end)
        : none,
    },
  ];
  const tiles = loading ? loaded.map((tile) => ({ label: tile.label, value: NO_VALUE, detail: BLANK_LINE })) : loaded;
  return (
    <View className="flex-row flex-wrap gap-3">
      {tiles.map((tile) => (
        <View
          key={tile.label}
          accessible
          accessibilityLabel={`${tile.label}: ${tile.value}, ${tile.detail}`}
          className="min-w-[40%] flex-1 basis-[40%] gap-1 rounded-grouped bg-grouped p-4"
        >
          <Typography type="body-xs" className="text-grouped-secondary" numberOfLines={1}>
            {tile.label}
          </Typography>
          <UsageValue value={tile.value}>
            <Typography className="text-2xl font-semibold" numberOfLines={1} adjustsFontSizeToFit>
              {tile.value}
            </Typography>
          </UsageValue>
          <UsageValue value={tile.detail}>
            <Typography type="body-xs" className="text-grouped-secondary" numberOfLines={1}>
              {tile.detail}
            </Typography>
          </UsageValue>
        </View>
      ))}
    </View>
  );
}

/**
 * The year of the user's work on the paired desktop, under the profile header, as the desktop
 * Profile tab shows it: five tiles, the year of days, the insights, the teammates and the models.
 * While the report loads, the same layout shows with no values, and the values then move into it.
 * Nothing shows without a paired desktop or when its host has no analytics.
 */
export function ProfileActivity({ activity }: { activity: ProfileActivityState }) {
  const { t, format } = useText();
  const dates = useProfileDates();
  const reducedMotion = useReducedMotion();
  const { server, online, report, stats, range } = activity;
  const placeholder = useMemo(() => placeholderStats(range), [range]);
  if (!server) return null;
  const title = t("mobile.settings.profile.activity.title", { server: server.name });
  const percent = (value: number) => format.percent(value, { maximumFractionDigits: 0 });
  const connecting = server.state === "connecting" || server.state === "unknown";
  const loading = !stats && (online ? report.isPending : connecting);

  if (!online && !stats && !connecting)
    return <SettingsNote>{t("mobile.settings.profile.activity.offline", { server: server.name })}</SettingsNote>;
  if (report.isError && !stats)
    return (
      <SettingsSection title={title}>
        <View className="items-start gap-2 p-4">
          <Typography.Paragraph accessibilityRole="alert" className="text-danger-text">
            {t("mobile.settings.profile.activity.loadFailed")}
          </Typography.Paragraph>
          <Button variant="secondary" size="sm" onPress={() => void report.refetch()}>
            <Button.Label>{t("common.retry")}</Button.Label>
          </Button>
        </View>
      </SettingsSection>
    );
  if (!stats && !loading) return null;

  const shown = stats ?? placeholder;
  const topProvider = shown.providers[0];
  const topModel = shown.models[0];
  const insights = loading
    ? [
        t("mobile.settings.profile.insights.provider"),
        t("mobile.settings.profile.insights.model"),
        t("mobile.settings.profile.insights.weekday"),
      ].map((label) => ({ label, value: NO_VALUE }))
    : [
        topProvider
          ? {
              label: t("mobile.settings.profile.insights.provider"),
              value: `${providerName(topProvider.provider)} · ${percent(topProvider.share)}`,
            }
          : null,
        topModel ? { label: t("mobile.settings.profile.insights.model"), value: topModel.model } : null,
        shown.busiestWeekday === null
          ? null
          : { label: t("mobile.settings.profile.insights.weekday"), value: dates.weekday(shown.busiestWeekday) },
        shown.cost === null
          ? null
          : { label: t("mobile.settings.profile.insights.cost"), value: format.currencyUsd(shown.cost) },
      ].filter((row) => row !== null);
  const sectionIn = reducedMotion ? undefined : SECTION_IN;
  const sectionOut = reducedMotion ? undefined : SECTION_OUT;

  return (
    // A section that shows with the screen does not fade in; one that the report adds later does.
    <LayoutAnimationConfig skipEntering>
      <UsageLoading loading={loading}>
        <View className="gap-7">
          <ProfileTiles stats={shown} loading={loading} />
          <SettingsSection title={title}>
            <ProfileHeatmap
              days={shown.days}
              loading={loading}
              label={
                loading
                  ? t("mobile.settings.profile.activity.loading")
                  : t("mobile.settings.profile.activity.heatmapLabel", {
                      tokens: format.compact(shown.tokens),
                      count: shown.activeDays,
                    })
              }
              summary={
                loading
                  ? t("mobile.settings.profile.activity.loading")
                  : shown.activeDays > 0
                    ? t("mobile.settings.profile.activity.activeDays", { count: shown.activeDays })
                    : t("mobile.settings.profile.activity.empty")
              }
            />
          </SettingsSection>
          {loading || shown.tokens > 0 ? (
            <Animated.View entering={sectionIn} exiting={sectionOut}>
              <SettingsSection title={t("mobile.settings.profile.insights.title")}>
                {insights.map((row) => (
                  <SettingsRow
                    key={row.label}
                    trailing={
                      <UsageValue value={row.value}>
                        <Typography className="text-grouped-secondary" numberOfLines={1}>
                          {row.value}
                        </Typography>
                      </UsageValue>
                    }
                  >
                    <Typography>{row.label}</Typography>
                  </SettingsRow>
                ))}
              </SettingsSection>
            </Animated.View>
          ) : null}
          {shown.teammates.length > 0 ? (
            <Animated.View entering={sectionIn} exiting={sectionOut}>
              <SettingsSection title={t("mobile.settings.profile.teammates.title")}>
                {shown.teammates.slice(0, 4).map((row) => (
                  <SettingsRow
                    key={row.agent.id}
                    leading={<AgentProviderAvatar agent={row.agent} size={AVATAR_SIZE} />}
                    trailing={
                      <UsageValue value={format.compact(row.tokens)}>
                        <Typography className="font-semibold">{format.compact(row.tokens)}</Typography>
                      </UsageValue>
                    }
                  >
                    <Typography numberOfLines={1}>{row.agent.name}</Typography>
                  </SettingsRow>
                ))}
              </SettingsSection>
            </Animated.View>
          ) : null}
          {shown.models.length > 0 && shown.tokens > 0 ? (
            <Animated.View entering={sectionIn} exiting={sectionOut}>
              <SettingsSection title={t("mobile.settings.profile.models.title")}>
                {shown.models.map((model) => (
                  <View key={`${model.provider}/${model.model}`} className="gap-2 px-4 py-3">
                    <View className="flex-row items-center gap-3">
                      <Typography className="min-w-0 flex-1" numberOfLines={1}>
                        {model.model}
                      </Typography>
                      <Typography type="body-xs" className="text-grouped-secondary">
                        {percent(model.share)}
                      </Typography>
                    </View>
                    <View className="h-1 overflow-hidden rounded-full bg-grouped-border">
                      <UsageBar
                        className="h-full bg-accent"
                        style={{ width: `${Math.min(100, Math.max(0, model.share * 100))}%` }}
                      />
                    </View>
                  </View>
                ))}
              </SettingsSection>
            </Animated.View>
          ) : null}
        </View>
      </UsageLoading>
    </LayoutAnimationConfig>
  );
}
