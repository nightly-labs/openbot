import type { RoutineCalendarRoutine, RoutineCalendarRun, RoutineCalendarRunStatus } from "@openbot/contracts/ipc";
import type { MobileTextKey } from "@openbot/i18n/mobile";
import {
  addCalendarDays,
  type CalendarDay,
  calendarDayDate,
  calendarDayOf,
  calendarDays,
  calendarWeekStart,
} from "@openbot/team-client/routine-calendar-dates";
import { useQuery } from "@tanstack/react-query";
import { router, Stack, useLocalSearchParams } from "expo-router";
import { Typography } from "heroui-native";
import { Check, CirclePause, X } from "lucide-react-native";
import { useEffect, useMemo, useState } from "react";
import { View } from "react-native";
import { useCSSVariable } from "uniwind";
import { BloubAvatar } from "@/features/agents/components/bloub-avatar";
import { useMobileSession } from "@/features/auth/context/mobile-session-context";
import { useChannels } from "@/features/channels/components/use-channels";
import { WeekPager } from "@/features/servers/components/week-pager";
import {
  SettingsContent,
  SettingsNote,
  SettingsRow,
  SettingsSection,
} from "@/features/settings/components/settings-content";
import { useMobileWorkspace } from "@/features/workspace/context/mobile-workspace-context";
import type { MobileAgent } from "@/features/workspace/model/workspace-types";
import { haptics } from "@/shared/lib/haptics";
import { useText } from "@/shared/lib/text";

const DAY = 86_400_000;
/** As on desktop: a week day shows this many runs. The rest are one step away, in the day view. */
const WEEK_DAY_LIMIT = 4;
const UPCOMING_LIMIT = 6;
const AVATAR_LIMIT = 3;
const AVATAR_SIZE = 26;

type CalendarView = "week" | "day";

/** As on desktop: `active` or `paused` before a run, `completed` or `failed` after it. */
type RunStatus = "active" | "paused" | "failed" | "completed";

const STATUS_LABEL = {
  active: "mobile.server.routines.status.active",
  paused: "mobile.server.routines.status.paused",
  failed: "mobile.server.routines.status.failed",
  completed: "mobile.server.routines.status.completed",
} as const satisfies Record<RunStatus, MobileTextKey>;

interface Entry {
  run: RoutineCalendarRun;
  routine: RoutineCalendarRoutine;
  status: RunStatus;
  day: CalendarDay;
  agents: MobileAgent[];
  owner: string | undefined;
}

/** Before a run, the routine state says what happens; after it, the outcome does. */
function runStatus(status: RoutineCalendarRunStatus, routineActive: boolean): RunStatus {
  switch (status) {
    case "scheduled":
      return routineActive ? "active" : "paused";
    case "queued":
    case "running":
      return "active";
    case "succeeded":
    case "cancelled":
      return "completed";
    case "failed":
    case "interrupted":
    case "needs-attention":
      return "failed";
  }
}

/**
 * The runs of the shown days in instants. A calendar day in the viewer's zone can start up to 14 hours
 * either side of UTC midnight, so each end takes one more day; the list drops the days it does not show.
 */
function rangeAround(first: CalendarDay, last: CalendarDay) {
  return {
    from: new Date(Date.parse(first) - DAY).toISOString(),
    to: new Date(Date.parse(last) + 2 * DAY).toISOString(),
  };
}

export function ServerRoutinesScreen() {
  const { t, format } = useText();
  const { serverId } = useLocalSearchParams<{ serverId: string }>();
  const { session, sessionScope } = useMobileSession();
  const { servers, agents, loadRoutineCalendar } = useMobileWorkspace();
  const { channels } = useChannels(serverId);
  const server = servers.find((item) => item.id === serverId);
  const online = server?.state === "online";
  const timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone;
  const [now, setNow] = useState(() => new Date());
  const today = calendarDayOf(now, timeZone);
  const [view, setView] = useState<CalendarView>("week");
  const [anchor, setAnchor] = useState(today);
  const week = calendarDays(calendarWeekStart(anchor, 1), 7);
  const days = view === "week" ? week : [anchor];
  // The day view loads its whole week, so the day strip can mark the days that have runs.
  const range = rangeAround(week[0] ?? anchor, week.at(-1) ?? anchor);

  // A planned run that passes without a result keeps its place; the clock only moves "now".
  useEffect(() => {
    const clock = setInterval(() => setNow(new Date()), 60_000);
    return () => clearInterval(clock);
  }, []);

  const calendar = useQuery({
    queryKey: ["server-routines", session?.apiUrl, session?.user.id, sessionScope, serverId, range.from, range.to],
    enabled: online,
    retry: false,
    queryFn: () => loadRoutineCalendar(range, serverId),
  });

  const entries = useMemo(() => {
    const data = calendar.data;
    if (!data) return [];
    const routines = new Map(data.routines.map((routine) => [routine.id, routine]));
    const serverAgents = new Map(
      agents.filter((agent) => agent.serverId === serverId).map((agent) => [agent.id, agent]),
    );
    const channelById = new Map(channels.map((channel) => [channel.id, channel]));
    return data.runs
      .flatMap((run): Entry[] => {
        const routine = routines.get(run.routineId);
        if (!routine) return [];
        const channel = routine.owner.kind === "channel" ? channelById.get(routine.owner.channelId) : undefined;
        const agentIds =
          routine.owner.kind === "agent"
            ? [routine.owner.agentId]
            : (channel?.members.map((member) => member.agentId) ?? []);
        const runAgents = agentIds.flatMap((id) => serverAgents.get(id) ?? []);
        return [
          {
            run,
            routine,
            status: runStatus(run.status, routine.active),
            day: calendarDayOf(new Date(run.at), timeZone),
            agents: runAgents,
            owner: routine.owner.kind === "agent" ? runAgents[0]?.name : channel?.name,
          },
        ];
      })
      .sort((left, right) => Date.parse(left.run.at) - Date.parse(right.run.at));
  }, [calendar.data, agents, channels, serverId, timeZone]);

  const entriesByDay = new Map<CalendarDay, Entry[]>();
  for (const entry of entries) {
    const list = entriesByDay.get(entry.day);
    if (list) list.push(entry);
    else entriesByDay.set(entry.day, [entry]);
  }
  const countByDay = new Map([...entriesByDay].map(([day, list]) => [day, list.length]));
  const upcoming = entries
    .filter((entry) => entry.status === "active" && Date.parse(entry.run.at) >= now.getTime())
    .slice(0, UPCOMING_LIMIT);

  const dayText = (day: CalendarDay, options: Intl.DateTimeFormatOptions) =>
    format.date(calendarDayDate(day), { ...options, timeZone: "UTC" });
  const longDay = (day: CalendarDay) => dayText(day, { weekday: "long", month: "long", day: "numeric" });
  const dayTitle = (day: CalendarDay) =>
    day === today ? t("mobile.server.routines.todayTitle", { day: longDay(day) }) : longDay(day);
  const timeText = (at: string) => format.date(new Date(at), { hour: "numeric", minute: "2-digit", timeZone });
  const upcomingWhen = (entry: Entry) => {
    const time = timeText(entry.run.at);
    if (entry.day === today) return t("mobile.server.routines.todayAt", { time });
    if (entry.day === addCalendarDays(today, 1)) return t("mobile.server.routines.tomorrowAt", { time });
    return t("mobile.server.routines.dayAt", {
      day: dayText(entry.day, { weekday: "short", month: "short", day: "numeric" }),
      time,
    });
  };
  const rangeLabel = t("mobile.server.routines.range", {
    start: dayText(week[0] ?? anchor, { month: "short", day: "numeric" }),
    end: dayText(week.at(-1) ?? anchor, { month: "short", day: "numeric", year: "numeric" }),
  });

  function openRoutine(routine: RoutineCalendarRoutine) {
    if (routine.owner.kind === "agent")
      router.push({
        pathname: "/server-routines/agent-routine",
        params: { agentId: routine.owner.agentId, serverId, recordId: routine.id },
      });
    else
      router.push({
        pathname: "/server-routines/channel-routine",
        params: { channelId: routine.owner.channelId, serverId, recordId: routine.id },
      });
  }

  function moveTo(day: CalendarDay, nextView: CalendarView = view) {
    void haptics.selection();
    setAnchor(day);
    setView(nextView);
  }

  /** Another week keeps the weekday of the open day. */
  const moveWeek = (weeks: number) => moveTo(addCalendarDays(anchor, weeks * 7));
  const showWeek = (weekStart: CalendarDay) =>
    moveTo(addCalendarDays(weekStart, Math.round((Date.parse(anchor) - Date.parse(week[0] ?? anchor)) / DAY)));

  const renderEntry = (entry: Entry, when: string) => {
    const status = t(STATUS_LABEL[entry.status]);
    return (
      <SettingsRow
        key={entry.run.id}
        leading={<StatusMark status={entry.status} />}
        trailing={entry.agents.length > 0 ? <AgentStack agents={entry.agents} serverId={serverId} /> : undefined}
        supportingText={
          entry.owner
            ? t("mobile.server.routines.entryMeta", { when, owner: entry.owner, status })
            : t("mobile.server.routines.entryMetaShort", { when, status })
        }
        onPress={() => openRoutine(entry.routine)}
      >
        <Typography.Paragraph numberOfLines={1}>{entry.routine.name}</Typography.Paragraph>
      </SettingsRow>
    );
  };

  const emptyRow = (key: MobileTextKey) => (
    <SettingsRow>
      <Typography.Paragraph className="text-grouped-secondary">{t(key)}</Typography.Paragraph>
    </SettingsRow>
  );

  const header = (
    <Stack.Toolbar placement="right">
      <Stack.Toolbar.Menu
        accessibilityLabel={t("mobile.server.routines.view")}
        title={t("mobile.server.routines.view")}
      >
        <Stack.Toolbar.Label>
          {t(view === "week" ? "mobile.server.routines.viewWeek" : "mobile.server.routines.viewDay")}
        </Stack.Toolbar.Label>
        <Stack.Toolbar.MenuAction
          icon="calendar.badge.clock"
          disabled={days.includes(today)}
          onPress={() => moveTo(today)}
        >
          {t("mobile.server.routines.today")}
        </Stack.Toolbar.MenuAction>
        <Stack.Toolbar.MenuAction
          icon="calendar.day.timeline.left"
          isOn={view === "day"}
          onPress={() => moveTo(anchor, "day")}
        >
          {t("mobile.server.routines.viewDay")}
        </Stack.Toolbar.MenuAction>
        <Stack.Toolbar.MenuAction icon="calendar" isOn={view === "week"} onPress={() => moveTo(anchor, "week")}>
          {t("mobile.server.routines.viewWeek")}
        </Stack.Toolbar.MenuAction>
      </Stack.Toolbar.Menu>
    </Stack.Toolbar>
  );

  if (!server)
    return (
      <SettingsContent>
        <SettingsNote>{t("mobile.server.unavailable")}</SettingsNote>
      </SettingsContent>
    );

  return (
    <>
      {header}
      <SettingsContent>
        <View className="gap-2">
          <Typography.Paragraph
            weight="medium"
            align="center"
            accessibilityRole="adjustable"
            accessibilityLiveRegion="polite"
            accessibilityActions={[
              { name: "decrement", label: t("mobile.server.routines.previousWeek") },
              { name: "increment", label: t("mobile.server.routines.nextWeek") },
            ]}
            onAccessibilityAction={(event) => moveWeek(event.nativeEvent.actionName === "increment" ? 1 : -1)}
          >
            {rangeLabel}
          </Typography.Paragraph>
          <WeekPager
            anchor={anchor}
            today={today}
            selected={view === "day" ? anchor : null}
            counts={countByDay}
            weekdayText={(day) => dayText(day, { weekday: "narrow" })}
            dayNumberText={(day) => dayText(day, { day: "numeric" })}
            dayLabel={(day, count) => t("mobile.server.routines.dayLabel", { day: longDay(day), count })}
            onSelectDay={(day) => moveTo(day, "day")}
            onWeekChange={showWeek}
          />
        </View>

        {!online && !calendar.data ? (
          <SettingsNote>{t("mobile.server.routines.offline")}</SettingsNote>
        ) : calendar.isPending ? (
          <SettingsNote>{t("mobile.server.routines.loading")}</SettingsNote>
        ) : calendar.isError ? (
          <SettingsSection footer={t("mobile.server.routines.loadFailed")}>
            <SettingsRow disclosure={false} onPress={() => void calendar.refetch()}>
              <Typography.Paragraph>{t("common.retry")}</Typography.Paragraph>
            </SettingsRow>
          </SettingsSection>
        ) : calendar.data?.routines.length === 0 ? (
          <SettingsNote>{t("mobile.server.routines.empty")}</SettingsNote>
        ) : (
          <>
            {view === "week" ? (
              week.map((day) => {
                const dayEntries = entriesByDay.get(day) ?? [];
                const hidden = dayEntries.length - WEEK_DAY_LIMIT;
                return (
                  <SettingsSection key={day} title={dayTitle(day)}>
                    {dayEntries.length > 0
                      ? dayEntries.slice(0, WEEK_DAY_LIMIT).map((entry) => renderEntry(entry, timeText(entry.run.at)))
                      : emptyRow("mobile.server.routines.dayEmpty")}
                    {hidden > 0 ? (
                      <SettingsRow
                        accessibilityLabel={t("mobile.server.routines.showAll", {
                          count: dayEntries.length,
                          day: longDay(day),
                        })}
                        onPress={() => moveTo(day, "day")}
                      >
                        <Typography.Paragraph className="text-accent-text">
                          {t("mobile.server.routines.more", { count: hidden })}
                        </Typography.Paragraph>
                      </SettingsRow>
                    ) : null}
                  </SettingsSection>
                );
              })
            ) : (
              <SettingsSection title={dayTitle(anchor)}>
                {(entriesByDay.get(anchor) ?? []).length > 0
                  ? (entriesByDay.get(anchor) ?? []).map((entry) => renderEntry(entry, timeText(entry.run.at)))
                  : emptyRow("mobile.server.routines.dayEmpty")}
              </SettingsSection>
            )}
            {/* Next to another day, the next runs read as runs of that day, so only today shows them. */}
            {view === "day" && anchor === today ? (
              <SettingsSection title={t("mobile.server.routines.upcoming")}>
                {upcoming.length > 0
                  ? upcoming.map((entry) => renderEntry(entry, upcomingWhen(entry)))
                  : emptyRow("mobile.server.routines.upcomingEmpty")}
              </SettingsSection>
            ) : null}
          </>
        )}
        <Typography.Paragraph type="body-xs" className="px-4 text-grouped-secondary">
          {t("mobile.server.routines.timeZone", { zone: timeZone.replaceAll("_", " ") })}
        </Typography.Paragraph>
      </SettingsContent>
    </>
  );
}

/** The agents of a run, as on desktop: the agent of an agent routine, or the members of a channel. */
function AgentStack({ agents, serverId }: { agents: MobileAgent[]; serverId: string }) {
  const shown = agents.slice(0, AVATAR_LIMIT);
  const hidden = agents.length - shown.length;
  return (
    <View className="flex-row items-center" accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
      {shown.map((agent, index) => (
        <View key={agent.id} style={{ marginLeft: index === 0 ? 0 : -AVATAR_SIZE / 3 }}>
          <BloubAvatar
            agentId={agent.id}
            serverId={serverId}
            hue={agent.avatarHue}
            seed={agent.avatarSeed}
            size={AVATAR_SIZE}
            animateIdle={false}
          />
        </View>
      ))}
      {hidden > 0 ? (
        <Typography type="body-xs" className="ml-1 text-grouped-secondary">
          +{hidden}
        </Typography>
      ) : null}
    </View>
  );
}

/** As on desktop: a dot for a planned run, and a mark for a paused, failed or completed one. */
function StatusMark({ status }: { status: RunStatus }) {
  const muted = String(useCSSVariable("--openbot-text-grouped-secondary"));
  const accent = String(useCSSVariable("--openbot-accent-text"));
  const success = String(useCSSVariable("--openbot-success-text"));
  const danger = String(useCSSVariable("--openbot-danger-text"));
  return (
    <View className="size-4 items-center justify-center">
      {status === "paused" ? (
        <CirclePause color={muted} size={16} strokeWidth={1.8} />
      ) : status === "failed" ? (
        <X color={danger} size={16} strokeWidth={2} />
      ) : status === "completed" ? (
        <Check color={success} size={16} strokeWidth={2} />
      ) : (
        <View className="size-2 rounded-full" style={{ backgroundColor: accent }} />
      )}
    </View>
  );
}
