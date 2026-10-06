import type { RoutineSchedule } from "@openbot/contracts/ipc";
import type { AppTextKey } from "@openbot/i18n";
import {
  addCalendarDays,
  type CalendarDay,
  calendarDayDate,
  calendarDayOf,
  calendarDays,
  calendarHourOf,
  calendarWeekStart,
  clockChangeDay,
} from "@openbot/team-client/routine-calendar-dates";
import {
  Alert,
  AlertActions,
  AlertContent,
  AlertDescription,
  ArrowLeft,
  Button,
  CalendarClock,
  Check,
  ChevronLeft,
  ChevronRight,
  CirclePause,
  IconButton,
  Skeleton,
  SlidingTabs,
  X,
} from "@openbot/ui";
import { createMemo, createStore, For, Match, onSettled, Show, Switch, untrack } from "solid-js";
import type { AgentProfile } from "../../data";
import { useText } from "../../text";
import { AgentAvatar } from "../agents/AgentAvatar";
import { routineScheduleSummary } from "./routine-schedule-ui";

/**
 * A run is `active` or `paused` before it happens, and `completed` or `failed` after it. A paused
 * routine still shows its runs, so the person sees what resuming it brings back.
 */
export type RoutineCalendarStatus = "active" | "paused" | "failed" | "completed";
export type RoutineCalendarView = "week" | "day";
export type RoutineCalendarAgent = Pick<AgentProfile, "id" | "name" | "avatarSeed" | "avatarHue" | "avatarUrl">;

export interface RoutineCalendarRoutine {
  id: string;
  name: string;
  agentIds: string[];
  schedule: RoutineSchedule;
}

/** One run of a routine. The host expands the schedules, so the calendar never parses a cron. */
export interface RoutineCalendarRun {
  id: string;
  routineId: string;
  at: string;
  status: RoutineCalendarStatus;
}

export interface RoutineCalendarProps {
  routines: RoutineCalendarRoutine[];
  runs: RoutineCalendarRun[];
  agents: RoutineCalendarAgent[];
  now: Date;
  /** The viewer's IANA time zone. Days and times show in it. */
  timeZone: string;
  state?: "ready" | "loading" | "error";
  errorText?: string;
  initialView?: RoutineCalendarView;
  /** 0 is Sunday, 1 is Monday. */
  weekStartsOn?: number;
  /** The first and last day the calendar shows, after each move, so the host can load their runs. */
  onRangeChange?: (first: CalendarDay, last: CalendarDay) => void;
  onOpenRoutine: (routineId: string) => void;
  onOpenAgent: (agentId: string) => void;
  onRetry?: () => void;
  onCreateRoutine?: () => void;
  /** A full-pane calendar has a way back. With it, the heading takes focus when the calendar opens. */
  onBack?: () => void;
  /** The host whose routines show, after the title. */
  hostName?: string;
}

interface CalendarEntry {
  run: RoutineCalendarRun;
  routine: RoutineCalendarRoutine;
  agents: RoutineCalendarAgent[];
}

/** A week day shows this many runs. The rest are one step away, in the day view. */
const WEEK_DAY_LIMIT = 4;
const UPCOMING_LIMIT = 6;

const STATUS_LABEL = {
  active: "routine.settings.active",
  paused: "routine.settings.paused",
  failed: "routine.runStatus.failed",
  completed: "routine.calendar.completed",
} as const satisfies Record<RoutineCalendarStatus, AppTextKey>;

export function RoutineCalendar(props: RoutineCalendarProps) {
  const text = useText();
  const { t, format } = text;
  const today = () => calendarDayOf(props.now, props.timeZone);
  // The props only seed the view: after that, the person moves it.
  const [state, setState] = createStore(
    untrack(() => ({
      view: props.initialView ?? "week",
      anchor: calendarDayOf(props.now, props.timeZone),
    })),
  );

  const daysFor = (anchor: CalendarDay, view: RoutineCalendarView) =>
    view === "week" ? calendarDays(calendarWeekStart(anchor, props.weekStartsOn ?? 1), 7) : [anchor];
  const visibleDays = createMemo(() => daysFor(state.anchor, state.view));

  const entries = createMemo(() => {
    const routines = new Map(props.routines.map((routine) => [routine.id, routine]));
    const agents = new Map(props.agents.map((agent) => [agent.id, agent]));
    const result: CalendarEntry[] = [];
    for (const run of props.runs) {
      const routine = routines.get(run.routineId);
      if (!routine) continue;
      const runAgents = routine.agentIds.flatMap((id) => agents.get(id) ?? []);
      result.push({ run, routine, agents: runAgents });
    }
    return result.sort((left, right) => Date.parse(left.run.at) - Date.parse(right.run.at));
  });

  const entriesByDay = createMemo(() => {
    const byDay = new Map<CalendarDay, CalendarEntry[]>();
    for (const entry of entries()) {
      const day = calendarDayOf(new Date(entry.run.at), props.timeZone);
      const list = byDay.get(day);
      if (list) list.push(entry);
      else byDay.set(day, [entry]);
    }
    return byDay;
  });

  const upcoming = createMemo(() =>
    entries()
      .filter((entry) => entry.run.status === "active" && Date.parse(entry.run.at) >= props.now.getTime())
      .slice(0, UPCOMING_LIMIT),
  );

  const clockChange = createMemo(() => clockChangeDay(visibleDays(), props.timeZone));

  const dayText = (day: CalendarDay, options: Intl.DateTimeFormatOptions) =>
    format.date(calendarDayDate(day), { ...options, timeZone: "UTC" });
  const longDay = (day: CalendarDay) => dayText(day, { weekday: "long", month: "long", day: "numeric" });
  const timeText = (at: string) =>
    format.date(new Date(at), { hour: "numeric", minute: "2-digit", timeZone: props.timeZone });
  const statusText = (status: RoutineCalendarStatus) => t(STATUS_LABEL[status]);

  const rangeLabel = () => {
    const days = visibleDays();
    const first = days[0] ?? state.anchor;
    const last = days.at(-1) ?? state.anchor;
    if (state.view === "day") return longDay(first);
    return t("routine.calendar.range", {
      start: dayText(first, { month: "short", day: "numeric" }),
      end: dayText(last, { month: "short", day: "numeric", year: "numeric" }),
    });
  };

  let heading: HTMLHeadingElement | undefined;
  const moveTo = (anchor: CalendarDay, view: RoutineCalendarView = state.view) => {
    setState((draft) => {
      draft.anchor = anchor;
      draft.view = view;
    });
    const days = daysFor(anchor, view);
    const first = days[0];
    const last = days.at(-1);
    if (first && last) props.onRangeChange?.(first, last);
  };
  /** Today disables itself, and a day or "+N more" leaves the week: focus goes to the heading, not to the page. */
  const moveFrom = (anchor: CalendarDay, view?: RoutineCalendarView) => {
    moveTo(anchor, view);
    heading?.focus();
  };
  const step = (direction: -1 | 1) =>
    moveTo(addCalendarDays(state.anchor, direction * (state.view === "week" ? 7 : 1)));

  const upcomingWhen = (at: string) => {
    const day = calendarDayOf(new Date(at), props.timeZone);
    const time = timeText(at);
    if (day === today()) return t("routine.history.today", { time });
    if (day === addCalendarDays(today(), 1)) return t("routine.calendar.tomorrowAt", { time });
    return t("routine.card.nextRunAt", {
      day: dayText(day, { weekday: "short", month: "short", day: "numeric" }),
      time,
    });
  };

  onSettled(() => {
    if (untrack(() => props.onBack)) heading?.focus();
  });

  return (
    <section class="routine-planner" aria-labelledby="routine-planner-heading" data-view={state.view}>
      <header class="routine-planner-header">
        <div class="routine-planner-title">
          <div class="routine-planner-identity">
            <Show when={props.onBack}>
              {(back) => (
                <IconButton
                  variant="ghost"
                  label={t("common.back")}
                  data-cuelume-tap="navigate"
                  onClick={() => back()()}
                >
                  <ArrowLeft />
                </IconButton>
              )}
            </Show>
            <h2 id="routine-planner-heading" ref={heading} tabindex={-1}>
              {t("routine.calendar.title")}
              <Show when={props.hostName}>
                {(host) => (
                  <>
                    {" "}
                    <span aria-hidden="true">/</span> <span>{host()}</span>
                  </>
                )}
              </Show>
            </h2>
          </div>
          <p>{t("routine.calendar.timeZone", { zone: props.timeZone.replaceAll("_", " ") })}</p>
        </div>
        <div class="routine-planner-toolbar">
          <div class="routine-planner-nav">
            <IconButton
              variant="ghost"
              label={t(state.view === "week" ? "routine.calendar.previousWeek" : "routine.calendar.previousDay")}
              data-cuelume-tap="navigate"
              onClick={() => step(-1)}
            >
              <ChevronLeft aria-hidden="true" />
            </IconButton>
            <Button
              variant="outline"
              size="sm"
              disabled={visibleDays().includes(today())}
              data-cuelume-tap="navigate"
              onClick={() => moveFrom(today())}
            >
              {t("routine.calendar.today")}
            </Button>
            <IconButton
              variant="ghost"
              label={t(state.view === "week" ? "routine.calendar.nextWeek" : "routine.calendar.nextDay")}
              data-cuelume-tap="navigate"
              onClick={() => step(1)}
            >
              <ChevronRight aria-hidden="true" />
            </IconButton>
            <p class="routine-planner-range" aria-live="polite">
              {rangeLabel()}
            </p>
          </div>
          <SlidingTabs.Root
            value={state.view}
            onChange={(value) => moveTo(state.anchor, value === "day" ? "day" : "week")}
          >
            <SlidingTabs.List aria-label={t("routine.calendar.view")}>
              <SlidingTabs.Trigger value="day">{t("routine.calendar.viewDay")}</SlidingTabs.Trigger>
              <SlidingTabs.Trigger value="week">{t("routine.calendar.viewWeek")}</SlidingTabs.Trigger>
            </SlidingTabs.List>
          </SlidingTabs.Root>
        </div>
        <Show when={clockChange()}>
          {(day) => (
            <p class="routine-planner-clock-change">{t("routine.calendar.clockChange", { day: longDay(day()) })}</p>
          )}
        </Show>
      </header>

      <Switch>
        <Match when={(props.state ?? "ready") === "loading"}>
          <div class="routine-planner-body" aria-busy="true">
            <p class="sr-only" role="status">
              {t("routine.calendar.loading")}
            </p>
            <div class="routine-planner-week routine-planner-loading">
              <For each={visibleDays()}>
                {() => (
                  <div class="routine-planner-day">
                    <Skeleton class="routine-planner-skeleton-heading" />
                    <Skeleton class="routine-planner-skeleton-run" />
                    <Skeleton class="routine-planner-skeleton-run" />
                  </div>
                )}
              </For>
            </div>
          </div>
        </Match>
        <Match when={props.state === "error"}>
          <Alert tone="danger" class="routine-planner-error">
            <AlertContent>
              <AlertDescription>{props.errorText ?? t("routine.calendar.loadFailed")}</AlertDescription>
            </AlertContent>
            <Show when={props.onRetry}>
              <AlertActions>
                <Button variant="outline" size="sm" onClick={() => props.onRetry?.()}>
                  {t("common.retry")}
                </Button>
              </AlertActions>
            </Show>
          </Alert>
        </Match>
        <Match when={props.routines.length === 0}>
          <div class="routine-planner-empty">
            <CalendarClock aria-hidden="true" />
            <p>{t("routine.calendar.empty")}</p>
            <Show when={props.onCreateRoutine}>
              <Button size="sm" onClick={() => props.onCreateRoutine?.()}>
                {t("routine.settings.create")}
              </Button>
            </Show>
          </div>
        </Match>
        <Match when={true}>
          <div class="routine-planner-body">
            <Show
              when={state.view === "week"}
              fallback={
                <RoutineCalendarDay
                  entries={entriesByDay().get(state.anchor) ?? []}
                  timeZone={props.timeZone}
                  timeText={timeText}
                  statusText={statusText}
                  onOpenRoutine={props.onOpenRoutine}
                  onOpenAgent={props.onOpenAgent}
                />
              }
            >
              <ol class="routine-planner-week">
                <For each={visibleDays()}>
                  {(day) => {
                    const dayEntries = () => entriesByDay().get(day) ?? [];
                    const hidden = () => Math.max(0, dayEntries().length - WEEK_DAY_LIMIT);
                    return (
                      <li
                        class="routine-planner-day"
                        aria-current={day === today() ? "date" : undefined}
                        data-past={day < today() ? "" : undefined}
                      >
                        <h3 class="routine-planner-day-heading">
                          <Button
                            variant="ghost"
                            size="xs"
                            class="routine-planner-day-button"
                            aria-label={t("routine.calendar.openDay", { day: longDay(day) })}
                            data-cuelume-tap="navigate"
                            onClick={() => moveFrom(day, "day")}
                          >
                            <span>{dayText(day, { weekday: "short" })}</span>
                            <strong>{dayText(day, { day: "numeric" })}</strong>
                          </Button>
                        </h3>
                        <Show when={dayEntries().length > 0}>
                          <ul class="routine-planner-runs">
                            <For each={dayEntries().slice(0, WEEK_DAY_LIMIT)}>
                              {(entry) => (
                                <li>
                                  <Button
                                    variant="ghost"
                                    class="routine-planner-run"
                                    data-status={entry.run.status}
                                    aria-label={t("routine.calendar.runLabel", {
                                      name: entry.routine.name,
                                      time: timeText(entry.run.at),
                                      status: statusText(entry.run.status),
                                    })}
                                    onClick={() => props.onOpenRoutine(entry.routine.id)}
                                  >
                                    <RoutineCalendarStatusMark status={entry.run.status} />
                                    <span class="routine-planner-run-time">{timeText(entry.run.at)}</span>
                                    <span class="routine-planner-run-name">{entry.routine.name}</span>
                                    <RoutineCalendarAvatars agents={entry.agents} />
                                  </Button>
                                </li>
                              )}
                            </For>
                          </ul>
                        </Show>
                        <Show when={hidden() > 0}>
                          <Button
                            variant="ghost"
                            size="xs"
                            class="routine-planner-more"
                            aria-label={t("routine.calendar.showAll", {
                              count: dayEntries().length,
                              day: longDay(day),
                            })}
                            data-cuelume-tap="navigate"
                            onClick={() => moveFrom(day, "day")}
                          >
                            {t("routine.calendar.more", { count: hidden() })}
                          </Button>
                        </Show>
                      </li>
                    );
                  }}
                </For>
              </ol>
            </Show>

            <aside class="routine-planner-upcoming" aria-labelledby="routine-planner-upcoming-heading">
              <h3 id="routine-planner-upcoming-heading">{t("routine.calendar.upcoming")}</h3>
              <Show
                when={upcoming().length > 0}
                fallback={<p class="routine-planner-note">{t("routine.calendar.upcomingEmpty")}</p>}
              >
                <ul class="routine-planner-entries">
                  <For each={upcoming()}>
                    {(entry) => (
                      <RoutineCalendarEntry
                        entry={entry}
                        when={upcomingWhen(entry.run.at)}
                        statusText={statusText}
                        onOpenRoutine={props.onOpenRoutine}
                        onOpenAgent={props.onOpenAgent}
                      />
                    )}
                  </For>
                </ul>
              </Show>
            </aside>
          </div>
        </Match>
      </Switch>
    </section>
  );
}

interface RoutineCalendarDayProps {
  entries: CalendarEntry[];
  timeZone: string;
  timeText: (at: string) => string;
  statusText: (status: RoutineCalendarStatus) => string;
  onOpenRoutine: (routineId: string) => void;
  onOpenAgent: (agentId: string) => void;
}

/** One day, in hours. Many runs at one hour stay a list under that hour, never a pile. */
function RoutineCalendarDay(props: RoutineCalendarDayProps) {
  const { t, format } = useText();
  const hours = createMemo(() => {
    const byHour = new Map<number, CalendarEntry[]>();
    for (const entry of props.entries) {
      const hour = calendarHourOf(new Date(entry.run.at), props.timeZone);
      const list = byHour.get(hour);
      if (list) list.push(entry);
      else byHour.set(hour, [entry]);
    }
    return [...byHour.values()];
  });
  return (
    <div class="routine-planner-day-view">
      <Show when={hours().length > 0} fallback={<p class="routine-planner-note">{t("routine.calendar.dayEmpty")}</p>}>
        <For each={hours()}>
          {(group) => (
            <section class="routine-planner-hour">
              <h3>{format.date(new Date(group[0]?.run.at ?? 0), { hour: "numeric", timeZone: props.timeZone })}</h3>
              <ul class="routine-planner-entries">
                <For each={group}>
                  {(entry) => (
                    <RoutineCalendarEntry
                      entry={entry}
                      when={props.timeText(entry.run.at)}
                      statusText={props.statusText}
                      onOpenRoutine={props.onOpenRoutine}
                      onOpenAgent={props.onOpenAgent}
                    />
                  )}
                </For>
              </ul>
            </section>
          )}
        </For>
      </Show>
    </div>
  );
}

interface RoutineCalendarEntryProps {
  entry: CalendarEntry;
  when: string;
  statusText: (status: RoutineCalendarStatus) => string;
  onOpenRoutine: (routineId: string) => void;
  onOpenAgent: (agentId: string) => void;
}

/** A run with its routine, recurrence and agents. The routine and each agent open on their own. */
function RoutineCalendarEntry(props: RoutineCalendarEntryProps) {
  const text = useText();
  const { t } = text;
  return (
    <li class="routine-planner-entry" data-status={props.entry.run.status}>
      <Button
        variant="ghost"
        class="routine-planner-entry-main"
        aria-label={t("routine.card.open", { name: props.entry.routine.name })}
        onClick={() => props.onOpenRoutine(props.entry.routine.id)}
      >
        <RoutineCalendarStatusMark status={props.entry.run.status} />
        <span class="routine-planner-entry-text">
          <span class="routine-planner-entry-name">{props.entry.routine.name}</span>
          <span class="routine-planner-entry-meta">
            {t("routine.calendar.entryMeta", {
              when: props.when,
              schedule: routineScheduleSummary(props.entry.routine.schedule, false, text),
              status: props.statusText(props.entry.run.status),
            })}
          </span>
        </span>
      </Button>
      <span class="routine-planner-entry-agents">
        <For each={props.entry.agents}>
          {(agent) => (
            <IconButton
              variant="ghost"
              class="routine-planner-agent"
              label={t("routine.calendar.openAgent", { name: agent.name })}
              data-cuelume-tap="navigate"
              onClick={() => props.onOpenAgent(agent.id)}
            >
              <AgentAvatar agent={agent} class="routine-planner-avatar" />
            </IconButton>
          )}
        </For>
      </span>
    </li>
  );
}

function RoutineCalendarAvatars(props: { agents: RoutineCalendarAgent[] }) {
  return (
    <span class="routine-planner-avatars" aria-hidden="true">
      <For each={props.agents.slice(0, 2)}>
        {(agent) => <AgentAvatar agent={agent} motion="idle" class="routine-planner-avatar" />}
      </For>
    </span>
  );
}

function RoutineCalendarStatusMark(props: { status: RoutineCalendarStatus }) {
  return (
    <span class="routine-planner-status" data-status={props.status} aria-hidden="true">
      <Switch fallback={<span class="routine-planner-status-dot" />}>
        <Match when={props.status === "paused"}>
          <CirclePause />
        </Match>
        <Match when={props.status === "failed"}>
          <X />
        </Match>
        <Match when={props.status === "completed"}>
          <Check />
        </Match>
      </Switch>
    </span>
  );
}
