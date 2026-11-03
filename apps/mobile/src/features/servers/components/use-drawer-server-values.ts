import { isAgentTaskOpen } from "@openbot/team-client/agent-tasks";
import { addCalendarDays, calendarDayOf } from "@openbot/team-client/routine-calendar-dates";
import { useQuery } from "@tanstack/react-query";
import { useEffect, useMemo } from "react";
import { lastUsageDays } from "@/features/agents/components/usage-range-picker";
import { useQueryScope } from "@/features/auth/context/mobile-session-context";
import { useServerThreadReads } from "@/features/chat/components/use-agent-thread-reads";
import { useServerTasks } from "@/features/servers/model/use-server-tasks";
import {
  useMobileWorkspaceActions,
  useMobileWorkspaceSelector,
} from "@/features/workspace/context/mobile-workspace-context";
import {
  DRAWER_ROUTINE_RUNS,
  rememberDrawerValues,
  useDrawerSnapshot,
} from "@/features/workspace/model/drawer-snapshot";
import { queryKeys } from "@/features/workspace/model/query-keys";
import type { MobileServer } from "@/features/workspace/model/workspace-types";
import { useText } from "@/shared/lib/text";

const HOUR = 3_600_000;
const DAY = 24 * HOUR;
/** The drawer looks this far ahead for the next routine run. */
const ROUTINE_LOOKAHEAD_DAYS = 8;
/**
 * The drawer shows only a later run, so its read starts after the time of the read. The calendar then
 * reads no run history: one request for each routine, with up to a page of runs. The margin keeps the
 * start after the time at which the calendar plans the runs.
 */
const ROUTINE_FROM_MARGIN_MS = 1_000;

/** How long the drawer keeps the time zone of the phone. A change of time zone shows after this time. */
const TIME_ZONE_TTL_MS = 60_000;
let phoneTimeZoneCache: { timeZone: string; readAt: number } | null = null;

/** The time zone of the phone. The Intl call is slow on Android, and the drawer renders often. */
function phoneTimeZone(now: number): string {
  if (!phoneTimeZoneCache || now - phoneTimeZoneCache.readAt >= TIME_ZONE_TTL_MS)
    phoneTimeZoneCache = { timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone, readAt: now };
  return phoneTimeZoneCache.timeZone;
}

export interface DrawerServerValues {
  /** `null` on a host without `agent-tasks-v1`: the drawer has no Tasks row then. */
  tasks: { value: string | null; needsYou: boolean } | null;
  /** When the next routine runs, such as "Tomorrow at 8:00". */
  nextRoutine: string | null;
  /** The estimated cost of the Usage screen's default period. */
  usage: string | null;
  members: string | null;
  memberCount: number | null;
}

/** The member count of a server, from the host's presence event, else from the last start. */
export function useDrawerMemberCount(serverId: string): number | null {
  const cached = useDrawerSnapshot(serverId).memberCount ?? null;
  return useMobileWorkspaceSelector((current) => current.memberCountByServer[serverId] ?? cached);
}

/**
 * The values beside the server rows of the drawer. They come from the host, read when the drawer
 * opens and refreshed by its events. The member count comes from the host's presence event, not
 * from the account service. Until the host answers, each value is the last one that the phone kept,
 * so the drawer does not change after a start.
 */
export function useDrawerServerValues(server: MobileServer | undefined, open: boolean): DrawerServerValues {
  const { t, format } = useText();
  const queryScope = useQueryScope();
  const { loadRoutineCalendar, loadHostAnalytics } = useMobileWorkspaceActions();
  const serverId = server?.id ?? "";
  const memberCount = useDrawerMemberCount(serverId);
  const cached = useDrawerSnapshot(serverId);
  const online = server?.state === "online";
  const enabled = open && online;

  // The key starts at the hour, so it stays the same while the drawer opens and closes. The read itself
  // starts at the time of the read.
  const start = Math.floor(Date.now() / HOUR) * HOUR;
  const from = new Date(start).toISOString();
  const to = new Date(start + ROUTINE_LOOKAHEAD_DAYS * DAY).toISOString();
  const serverTasks = useServerTasks(serverId, { enabled });
  const {
    reads: threadReads,
    ready: threadReadsReady,
    failed: threadReadsFailed,
  } = useServerThreadReads(serverId, serverTasks.tasks);
  const routines = useQuery({
    queryKey: queryKeys.serverRoutines(queryScope, serverId, from, to),
    queryFn: () =>
      loadRoutineCalendar({ from: new Date(Date.now() + ROUTINE_FROM_MARGIN_MS).toISOString(), to }, serverId),
    enabled,
    retry: false,
    staleTime: 60_000,
  });
  const range = lastUsageDays();
  const usage = useQuery({
    queryKey: queryKeys.serverUsage(queryScope, serverId, range),
    queryFn: () => loadHostAnalytics(range, serverId),
    enabled,
    retry: false,
    staleTime: 60_000,
  });

  const routineData = routines.data;
  const routineRuns = useMemo(() => {
    if (!routineData) return undefined;
    const active = new Set(
      routineData.routines.filter((routine) => routine.active && routine.owner.kind === "agent").map((r) => r.id),
    );
    const readAt = Date.now();
    return routineData.runs
      .filter(
        (run) =>
          (run.status === "scheduled" || run.status === "queued") &&
          active.has(run.routineId) &&
          Date.parse(run.at) >= readAt,
      )
      .map((run) => run.at)
      .sort((left, right) => Date.parse(left) - Date.parse(right))
      .slice(0, DRAWER_ROUTINE_RUNS);
  }, [routineData]);

  // Until the host answers, each value is the one of the last start. A failed read shows no value, as
  // it did before the phone kept them.
  const now = Date.now();
  const timeZone = phoneTimeZone(now);
  let nextRoutine: string | null = null;
  const next = (routineRuns ?? (routines.isError ? undefined : cached.routineRuns))?.find(
    (at) => Date.parse(at) >= now,
  );
  if (next) {
    const at = new Date(next);
    const day = calendarDayOf(at, timeZone);
    const today = calendarDayOf(new Date(now), timeZone);
    const time = format.date(at, { hour: "numeric", minute: "2-digit", timeZone });
    nextRoutine =
      day === today
        ? t("mobile.server.routines.todayAt", { time })
        : day === addCalendarDays(today, 1)
          ? t("mobile.server.routines.tomorrowAt", { time })
          : t("mobile.server.routines.dayAt", {
              day: format.date(at, { weekday: "short", timeZone }),
              time,
            });
  }
  const usageUsd = usage.data ? (usage.data.totals.estimatedCostUsd ?? null) : undefined;
  const cost = usageUsd !== undefined ? usageUsd : usage.isError ? null : (cached.usageUsd ?? null);
  // A large amount drops its cents: the row has room for a short value.
  const digits = cost !== null && cost >= 100 ? 0 : 2;
  // The threads with agent messages that the person has not read, else the threads that run. The host
  // keeps the read marks; a host without them shows only the threads that run.
  const unread = serverTasks.tasks.filter(
    (task) => isAgentTaskOpen(task) && (threadReads?.get(task.id)?.unreadCount ?? 0) > 0,
  ).length;
  const working = serverTasks.tasks.filter((task) => isAgentTaskOpen(task) && task.state === "running").length;
  // An online host has sent its capabilities. The counts of a failed list are not complete, so the
  // phone does not keep them.
  const tasksLoaded = online && (!serverTasks.supported || (enabled && serverTasks.ready && threadReadsReady));
  const tasksKnown = tasksLoaded && !serverTasks.retry && !threadReadsFailed;
  // With no kept counts, the row shows from the capabilities, as before.
  const tasks =
    tasksLoaded || cached.tasks === undefined ? (serverTasks.supported ? { unread, working } : null) : cached.tasks;

  const tasksSupported = serverTasks.supported;
  useEffect(() => {
    if (!serverId) return;
    rememberDrawerValues(serverId, {
      ...(routineRuns ? { routineRuns } : null),
      ...(usageUsd === undefined ? null : { usageUsd }),
      ...(tasksKnown ? { tasks: tasksSupported ? { unread, working } : null } : null),
    });
  }, [serverId, routineRuns, usageUsd, tasksKnown, tasksSupported, unread, working]);
  return {
    tasks: tasks
      ? {
          value: tasks.unread
            ? t("mobile.server.drawer.threadsUnread", { count: tasks.unread })
            : tasks.working
              ? t("mobile.server.drawer.threadsWorking", { count: tasks.working })
              : null,
          needsYou: tasks.unread > 0,
        }
      : null,
    nextRoutine,
    usage:
      cost === null ? null : format.currencyUsd(cost, { minimumFractionDigits: digits, maximumFractionDigits: digits }),
    members: memberCount === null ? null : format.number(memberCount),
    memberCount,
  };
}
