import { Button, ErrorReference, SettingsSection, Text } from "@openbot/ui";
import { Portal } from "@solidjs/web";
import { createMemo, createSignal, For, Show } from "solid-js";
import { useText } from "../../text";
import { AgentAvatar } from "../agents/AgentAvatar";
import { UsageProviderMark } from "../usage/UsageProviderMark";
import { usageCompact, usageCost, usageProviderName, usageSeriesColor } from "../usage/usage-format";
import { heatLevel, heatmapMonths, heatmapWeeks, type ProfileDay, type ProfileStats } from "./profile-stats";

export type ProfileActivityPhase = "loading" | "ready" | "error" | "unsupported";

/** A day of the report as the user reads it: the date is in the report's zone, not in UTC. */
function reportDate(date: string): number {
  return Date.parse(`${date}T00:00:00Z`);
}

export function useProfileDates() {
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
        : t("settings.profile.tile.range", {
            start: start.slice(0, 4) === end.slice(0, 4) ? short(start) : long(start),
            end: long(end),
          }),
    // 1 January 2023 is a Sunday, so the date of each weekday is that day plus its number.
    weekday: (weekday: number) => format.date(Date.UTC(2023, 0, 1 + weekday), { weekday: "long", timeZone: "UTC" }),
  };
}

/**
 * A year of days: one column for each week, Sunday at the top. A screen reader reads the summary
 * label. A pointer over a day shows its date and tokens in the chart tooltip. The cells stay in
 * place when a later report arrives, so a reload does not play the entrance again.
 */
export function ProfileHeatmap(props: { days: ProfileDay[]; label: string }) {
  const { t } = useText();
  const dates = useProfileDates();
  const model = createMemo(() => {
    const weeks = heatmapWeeks(props.days);
    const max = Math.max(0, ...props.days.map((day) => day.tokens));
    return {
      columns: weeks.map((week) => week.map((day) => (day ? { day, level: heatLevel(day, max) } : null))),
      months: heatmapMonths(weeks).map((month) => ({ column: month.week, label: dates.month(month.date) })),
    };
  });
  const [hover, setHover] = createSignal<{ day: ProfileDay; x: number; y: number } | null>(null);
  let root: HTMLDivElement | undefined;

  function showDay(day: ProfileDay, cell: HTMLElement): void {
    const rect = cell.getBoundingClientRect();
    const half = 96;
    const x = Math.min(Math.max(rect.left + rect.width / 2, half), window.innerWidth - half);
    setHover({ day, x, y: rect.top });
  }

  return (
    <div ref={root} class="profile-heatmap" style={{ "--profile-columns": String(model().columns.length) }}>
      <div class="profile-heatmap-months" aria-hidden="true">
        <For each={model().months} keyed={(month) => month.column}>
          {(month) => <span style={{ "grid-column": `${month().column + 1} / span 3` }}>{month().label}</span>}
        </For>
      </div>
      <div class="profile-heatmap-grid" role="img" aria-label={props.label} onPointerLeave={() => setHover(null)}>
        <For each={model().columns} keyed={false}>
          {(column, columnIndex) => (
            <For each={column()} keyed={false}>
              {(cell) => (
                <span
                  class="profile-heat-cell"
                  style={{ "--profile-col": String(columnIndex) }}
                  data-level={cell()?.level}
                  data-empty={cell() ? undefined : ""}
                  data-active={cell() && hover()?.day.date === cell()?.day.date ? "" : undefined}
                  onPointerEnter={(event) => {
                    const current = cell();
                    if (current) showDay(current.day, event.currentTarget);
                    else setHover(null);
                  }}
                />
              )}
            </For>
          )}
        </For>
      </div>
      <Show when={hover()}>
        {(current) => (
          <Portal mount={root?.closest<HTMLElement>("[role=dialog]") ?? document.body}>
            <div
              class="ui-chart-tooltip profile-heat-tooltip"
              aria-hidden="true"
              style={{ left: `${current().x}px`, top: `${current().y}px` }}
            >
              <strong>{dates.long(current().day.date)}</strong>
              <div>{t("settings.profile.activity.dayTokens", { tokens: usageCompact(current().day.tokens) })}</div>
            </div>
          </Portal>
        )}
      </Show>
      <div class="profile-heatmap-legend" aria-hidden="true">
        <span>{t("settings.profile.activity.less")}</span>
        <For each={[0, 1, 2, 3, 4]}>{(level) => <span class="profile-heat-cell" data-level={level} />}</For>
        <span>{t("settings.profile.activity.more")}</span>
      </div>
    </div>
  );
}

interface Tile {
  label: string;
  value: string;
  detail: string;
}

function ProfileTiles(props: { stats: ProfileStats }) {
  const { t } = useText();
  const dates = useProfileDates();
  const tiles = createMemo<Tile[]>(() => {
    const stats = props.stats;
    const none = t("settings.profile.tile.none");
    const days = (count: number) => t("settings.profile.tile.days", { count });
    return [
      {
        label: t("settings.profile.tile.tokens"),
        value: usageCompact(stats.tokens),
        detail: t("settings.profile.tile.pastYear"),
      },
      {
        label: t("settings.profile.tile.peakDay"),
        value: stats.peak ? usageCompact(stats.peak.tokens) : "–",
        detail: stats.peak ? dates.long(stats.peak.date) : none,
      },
      {
        label: t("settings.profile.tile.messages"),
        value: usageCompact(stats.messages),
        detail: t("settings.profile.tile.pastYear"),
      },
      {
        label: t("settings.profile.tile.currentStreak"),
        value: days(stats.currentStreak),
        detail: stats.currentStreakStart
          ? t("settings.profile.tile.since", { date: dates.short(stats.currentStreakStart) })
          : none,
      },
      {
        label: t("settings.profile.tile.longestStreak"),
        value: days(stats.longestStreak),
        detail: stats.longestStreakDates
          ? dates.range(stats.longestStreakDates.start, stats.longestStreakDates.end)
          : none,
      },
    ];
  });
  return (
    <dl class="profile-tiles">
      <For each={tiles()} keyed={(tile) => tile.label}>
        {(tile, index) => (
          <div class="profile-tile" style={{ "--profile-i": String(index()) }}>
            <dt>{tile().label}</dt>
            <dd>
              <strong>
                <span class="sr-only">{tile().value}</span>
                <span class="t-digit-group is-animating profile-tile-value" aria-hidden="true">
                  <For each={[...tile().value]}>
                    {(character, characterIndex) => (
                      <span class="t-digit" style={{ "--profile-c": String(characterIndex()) }}>
                        {character}
                      </span>
                    )}
                  </For>
                </span>
              </strong>
              <span>{tile().detail}</span>
            </dd>
          </div>
        )}
      </For>
    </dl>
  );
}

function percent(value: number): string {
  return `${Math.round(value * 100)}%`;
}

/**
 * The year of the user's work on this computer, under the profile header: five tiles, the year of
 * days, the insights, the teammates and the models. Nothing shows when the host has no analytics.
 */
export function ProfileActivity(props: {
  phase: ProfileActivityPhase;
  stats: ProfileStats | null;
  errorReference: string | null;
  onRetry: () => void;
}) {
  const { t } = useText();
  const dates = useProfileDates();
  const weekdayName = (weekday: number | null) => (weekday === null ? null : dates.weekday(weekday));
  return (
    <>
      <Show when={props.phase === "loading" && !props.stats}>
        <SettingsSection title={t("settings.profile.activity.title")}>
          <div class="profile-card profile-activity-placeholder" role="status">
            <Text tone="muted">{t("settings.profile.activity.loading")}</Text>
          </div>
        </SettingsSection>
      </Show>
      <Show when={props.phase === "error"}>
        <SettingsSection title={t("settings.profile.activity.title")}>
          <div class="profile-card profile-activity-placeholder">
            <Text role="alert" class="settings-modal-error">
              {t("settings.profile.activity.loadFailed")}
              <ErrorReference reference={props.errorReference} />
            </Text>
            <Button variant="secondary" onClick={props.onRetry}>
              {t("common.retry")}
            </Button>
          </div>
        </SettingsSection>
      </Show>
      <Show when={props.phase !== "error" ? props.stats : null}>
        {(stats) => (
          <>
            <ProfileTiles stats={stats()} />
            <SettingsSection
              title={t("settings.profile.activity.title")}
              description={
                stats().activeDays > 0
                  ? t("settings.profile.activity.activeDays", { count: stats().activeDays })
                  : t("settings.profile.activity.empty")
              }
            >
              <div class="profile-card">
                <ProfileHeatmap
                  days={stats().days}
                  label={t("settings.profile.activity.heatmapLabel", {
                    tokens: usageCompact(stats().tokens),
                    count: stats().activeDays,
                  })}
                />
              </div>
            </SettingsSection>
            <Show when={stats().tokens > 0}>
              <div class="profile-columns">
                <SettingsSection title={t("settings.profile.insights.title")}>
                  <dl class="profile-card profile-facts">
                    <Show when={stats().providers[0]}>
                      {(top) => (
                        <div>
                          <dt>{t("settings.profile.insights.provider")}</dt>
                          <dd>
                            <UsageProviderMark provider={top().provider} />
                            {usageProviderName(top().provider)} · {percent(top().share)}
                          </dd>
                        </div>
                      )}
                    </Show>
                    <Show when={stats().models[0]}>
                      {(top) => (
                        <div>
                          <dt>{t("settings.profile.insights.model")}</dt>
                          <dd>{top().model}</dd>
                        </div>
                      )}
                    </Show>
                    <Show when={weekdayName(stats().busiestWeekday)}>
                      {(weekday) => (
                        <div>
                          <dt>{t("settings.profile.insights.weekday")}</dt>
                          <dd>{weekday()}</dd>
                        </div>
                      )}
                    </Show>
                    <Show when={stats().cost !== null}>
                      <div>
                        <dt>{t("settings.profile.insights.cost")}</dt>
                        <dd>{usageCost(stats().cost)}</dd>
                      </div>
                    </Show>
                  </dl>
                </SettingsSection>
                <Show when={stats().teammates.length > 0}>
                  <SettingsSection title={t("settings.profile.teammates.title")}>
                    <ol class="profile-card profile-ranking">
                      <For each={stats().teammates.slice(0, 4)} keyed={(row) => row.agent.id}>
                        {(row, index) => (
                          <li style={{ "--profile-i": String(index()) }}>
                            <AgentAvatar agent={row().agent} class="profile-ranking-avatar" />
                            <span class="profile-ranking-name">{row().agent.name}</span>
                            <strong>{usageCompact(row().tokens)}</strong>
                          </li>
                        )}
                      </For>
                    </ol>
                  </SettingsSection>
                </Show>
              </div>
              <SettingsSection title={t("settings.profile.models.title")}>
                <ul class="profile-card profile-bars">
                  <For each={stats().models} keyed={(model) => `${model.provider}/${model.model}`}>
                    {(model, index) => (
                      <li style={{ "--profile-i": String(index()) }}>
                        <span class="profile-bar-label">
                          <UsageProviderMark provider={model().provider} />
                          <span class="profile-bar-name" title={model().model}>
                            {model().model}
                          </span>
                        </span>
                        <span class="profile-bar-track" aria-hidden="true">
                          <span
                            class="profile-bar-fill"
                            style={{ width: percent(model().share), background: usageSeriesColor(model().provider) }}
                          />
                        </span>
                        <span class="profile-bar-value">{percent(model().share)}</span>
                      </li>
                    )}
                  </For>
                </ul>
              </SettingsSection>
            </Show>
          </>
        )}
      </Show>
    </>
  );
}
