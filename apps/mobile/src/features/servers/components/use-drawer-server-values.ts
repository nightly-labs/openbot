import { isAgentTaskOpen } from "@openbot/team-client/agent-tasks";
import { addCalendarDays, calendarDayOf } from "@openbot/team-client/routine-calendar-dates";
import { useQuery } from "@tanstack/react-query";
import { useEffect, useMemo, useState } from "react";
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
import { useAppForeground } from "@/shared/lib/use-app-foreground";

const HOUR = 3_600_000;
const DAY = 24 * HOUR;
const ROUTINE_LOOKAHEAD_DAYS = 8;
const ROUTINE_FROM_MARGIN_MS = 1_000;

const TIME_ZONE_TTL_MS = 60_000;
let phoneTimeZoneCache: { timeZone: string; readAt: number } | null = null;

function phoneTimeZone(now: number): string {
  if (!phoneTimeZoneCache || now - phoneTimeZoneCache.readAt >= TIME_ZONE_TTL_MS)
    phoneTimeZoneCache = { timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone, readAt: now };
  return phoneTimeZoneCache.timeZone;
}

export interface DrawerServerValues {
  tasks: { value: string | null; needsYou: boolean } | null;
  nextRoutine: string | null;
  usage: string | null;
  members: string | null;
  memberCount: number | null;
}

export function useDrawerMemberCount(serverId: string): number | null {
  const cached = useDrawerSnapshot(serverId).memberCount ?? null;
  return useMobileWorkspaceSelector((current) => current.memberCountByServer[serverId] ?? cached);
}

export function useDrawerServerValues(server: MobileServer | undefined, open: boolean): DrawerServerValues {
  const { t, format } = useText();
  const queryScope = useQueryScope();
  const { loadRoutineCalendar, loadHostAnalytics } = useMobileWorkspaceActions();
  const serverId = server?.id ?? "";
  const memberCount = useDrawerMemberCount(serverId);
  const cached = useDrawerSnapshot(serverId);
  const online = server?.state === "online";
  const enabled = open && online;

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
  const foreground = useAppForeground();
  const [range, setRange] = useState(lastUsageDays);
  useEffect(() => {
    if (!open && !foreground) return;
    const today = lastUsageDays();
    setRange((current) =>
      current.startDate === today.startDate && current.endDate === today.endDate && current.timeZone === today.timeZone
        ? current
        : today,
    );
  }, [open, foreground]);
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
  const digits = cost !== null && cost >= 100 ? 0 : 2;
  const unread = serverTasks.tasks.filter(
    (task) => isAgentTaskOpen(task) && (threadReads?.get(task.id)?.unreadCount ?? 0) > 0,
  ).length;
  const working = serverTasks.tasks.filter((task) => isAgentTaskOpen(task) && task.state === "running").length;
  const tasksLoaded = online && (!serverTasks.supported || (enabled && serverTasks.ready && threadReadsReady));
  const tasksKnown = tasksLoaded && !serverTasks.retry && !threadReadsFailed;
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
