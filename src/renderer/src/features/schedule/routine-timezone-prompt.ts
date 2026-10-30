import type {
  EventRoutineOwner,
  RoutineCalendar,
  RoutineCalendarInput,
  RoutineCalendarOwner,
  RoutineCalendarRoutine,
  ServerSummary,
} from "@openbot/contracts/ipc";
import { routineOnceInstant } from "@openbot/team-client/routine-schedule";
import { toast } from "@openbot/ui";
import { currentText } from "@openbot/ui/text";
import { createEffect, onCleanup, untrack } from "solid-js";
import { actionToast } from "../../action-toast";
import { desktopEventRoutinesApi, type EventRoutinesApi } from "../conversation/routine-webhooks-api";
import type { HostTimezoneCalls } from "../servers/ServerTimezoneSetting";
import { serverCanAdminister } from "../servers/server-capabilities";

/**
 * One server whose routines the user can move: an owner or admin of a host with `events-v1`, or this
 * computer. `timezone` is set when the host also has `host-timezone-v1`.
 */
export interface RoutineZoneTarget {
  id: string;
  name: string;
  calendar: (input: RoutineCalendarInput) => Promise<RoutineCalendar>;
  events: Pick<EventRoutinesApi, "listRoutines" | "saveRoutine">;
  timezone?: HostTimezoneCalls | undefined;
}

/** This computer and each joined server that is online and lets this account move its routines. */
export function desktopRoutineZoneTargets(servers: readonly ServerSummary[]): RoutineZoneTarget[] {
  return servers
    .filter((server) => server.state === "online" && serverCanAdminister(server, "events-v1"))
    .map((server) => ({
      id: server.id,
      name: server.name,
      calendar: (input) => window.openbot.agent.routineCalendar(input, server.id),
      events: desktopEventRoutinesApi(server.id),
      timezone: serverCanAdminister(server, "host-timezone-v1") ? window.openbot.hostAdmin : undefined,
    }));
}

const toastId = (serverId: string) => `routine-timezone-move:${serverId}`;
const storageKey = (serverId: string) => `openbot:routine-timezone-answers:${serverId}`;

function deviceZone(): string {
  return Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
}

/**
 * The routine zones that the user answered on `serverId` for the device zone `zone`. The stored value
 * is one zone name for each line: the device zone first, then the answered zones.
 */
function answeredZones(serverId: string, zone: string): string[] {
  try {
    const [stored, ...answered] = (window.localStorage.getItem(storageKey(serverId)) ?? "").split("\n");
    return stored === zone ? answered : [];
  } catch {
    return [];
  }
}

function writeAnswer(serverId: string, zone: string, from: string): void {
  try {
    window.localStorage.setItem(storageKey(serverId), [zone, ...answeredZones(serverId, zone), from].join("\n"));
  } catch {
    // Blocked storage asks again on the next check.
  }
}

/**
 * Whether a move changes when the routine runs. An interval routine counts from its anchor instant. A
 * one-time routine whose time passed keeps that time as the record of its run.
 */
function followsClock(routine: RoutineCalendarRoutine, now: Date): boolean {
  const { schedule } = routine;
  if (schedule.kind === "interval") return false;
  return schedule.kind !== "once" || routineOnceInstant(schedule, routine.timezone) > now;
}

function eventOwner(owner: RoutineCalendarOwner): EventRoutineOwner {
  return owner.kind === "agent" ? { kind: "agent", id: owner.agentId } : { kind: "channel", id: owner.channelId };
}

const zoneLabel = (zone: string) => zone.replaceAll("_", " ");

/** The routines of `target` whose zone moves their clock times, by zone. */
async function routinesByZone(target: RoutineZoneTarget): Promise<Map<string, RoutineCalendarRoutine[]>> {
  const from = new Date(Date.now() + 60_000);
  const calendar = await target.calendar({
    from: from.toISOString(),
    to: new Date(from.getTime() + 60_000).toISOString(),
  });
  const byZone = new Map<string, RoutineCalendarRoutine[]>();
  const now = new Date();
  for (const routine of calendar.routines) {
    if (!followsClock(routine, now)) continue;
    byZone.set(routine.timezone, [...(byZone.get(routine.timezone) ?? []), routine]);
  }
  return byZone;
}

/**
 * Saves each routine in `from` again in `to`. The host keeps its ID and runs and computes the next run
 * at the same clock time in `to`. A Server Settings zone of `from` follows, so new routines match.
 */
async function moveRoutines(target: RoutineZoneTarget, from: string, to: string) {
  // Read the routines again: the toast can show for a long time before the click.
  const routines = (await routinesByZone(target)).get(from) ?? [];
  const owners = new Map<string, EventRoutineOwner>();
  for (const routine of routines) {
    const owner = eventOwner(routine.owner);
    owners.set(`${owner.kind}:${owner.id}`, owner);
  }
  const ids = new Set(routines.map((routine) => routine.id));
  let moved = 0;
  let failed = 0;
  for (const owner of owners.values()) {
    const records = await target.events.listRoutines({ owner });
    for (const record of records) {
      if (!ids.has(record.id) || record.timezone !== from || record.trigger.kind !== "schedule") continue;
      try {
        const saved = await target.events.saveRoutine({
          id: record.id,
          owner: record.owner,
          name: record.name,
          instruction: record.instruction,
          active: record.active,
          timezone: to,
          trigger: record.trigger,
          ...(record.limitPolicy ? { limitPolicy: record.limitPolicy } : {}),
          ...(record.missedPolicy ? { missedPolicy: record.missedPolicy } : {}),
        });
        if (saved.routine.timezone === to) moved += 1;
        else failed += 1;
      } catch {
        // For example a one-time run whose time is already past in the new zone.
        failed += 1;
      }
    }
  }
  let settingFailed = false;
  if (target.timezone && moved > 0) {
    try {
      const setting = await target.timezone.getTimezone(target.id);
      if (setting.timezone === from) await target.timezone.setTimezone(to, target.id);
    } catch {
      settingFailed = true;
    }
  }
  return { moved, failed, settingFailed };
}

/**
 * Asks to move the routines of each server in `targets` to the device's zone after the zone changed.
 * It asks once for each zone that routines use on a server, and again only after the next change of
 * the device zone.
 */
export function createRoutineTimezonePrompt(targets: () => RoutineZoneTarget[]): void {
  const checking = new Set<string>();
  /** The servers whose routines move now. A check waits for the move, so it does not ask again. */
  const moving = new Set<string>();
  /** The source and device zone of the toast that shows for each server. */
  const shown = new Map<string, string>();
  /** For each server, the source and device zones of toasts closed with no answer until the zone changes. */
  const dismissed = new Map<string, Set<string>>();

  async function check(target: RoutineZoneTarget): Promise<void> {
    if (checking.has(target.id) || moving.has(target.id)) return;
    checking.add(target.id);
    try {
      const zone = deviceZone();
      const byZone = await routinesByZone(target);
      // Read the answers after the wait: the user can answer or start a move while the list loads.
      if (moving.has(target.id)) return;
      const answered = answeredZones(target.id, zone);
      const next = [...byZone.entries()]
        .filter(
          ([source]) =>
            source !== zone && !answered.includes(source) && !dismissed.get(target.id)?.has(`${source}>${zone}`),
        )
        .sort((a, b) => b[1].length - a[1].length)[0];
      const key = next ? `${next[0]}>${zone}` : undefined;
      if (key === shown.get(target.id)) return;
      if (!next) {
        shown.delete(target.id);
        toast.dismiss(toastId(target.id));
        return;
      }
      const shownKey = `${next[0]}>${zone}`;
      shown.set(target.id, shownKey);
      const [source, routines] = next;
      const { t } = currentText();
      const answer = (move: boolean) => {
        shown.delete(target.id);
        if (move) {
          void runMove(target, source, zone);
          return;
        }
        writeAnswer(target.id, zone, source);
        void check(target);
      };
      toast(t("routine.timezoneMove.title", { zone: zoneLabel(zone) }), {
        id: toastId(target.id),
        description: t("routine.timezoneMove.description", {
          count: routines.length,
          server: target.name,
          from: zoneLabel(source),
          zone: zoneLabel(zone),
        }),
        // A toast closed without an answer comes back after the next start or zone change.
        duration: Number.POSITIVE_INFINITY,
        // The code removes `shown` before it closes a toast, so this is a close by the user.
        onDismiss: () => {
          if (shown.get(target.id) !== shownKey) return;
          shown.delete(target.id);
          dismissed.set(target.id, new Set([...(dismissed.get(target.id) ?? []), shownKey]));
        },
        action: { label: t("routine.timezoneMove.move"), onClick: () => answer(true) },
        cancel: { label: t("routine.timezoneMove.keep"), onClick: () => answer(false) },
      });
    } catch {
      // The host is not ready or does not answer. The next check tries again.
    } finally {
      checking.delete(target.id);
    }
  }

  /** A move that stops before its end keeps the question open, so the next check asks again. */
  async function runMove(target: RoutineZoneTarget, from: string, to: string): Promise<void> {
    const text = currentText();
    moving.add(target.id);
    try {
      const { moved, failed, settingFailed } = await moveRoutines(target, from, to);
      writeAnswer(target.id, to, from);
      if (settingFailed) actionToast.warning(text.t("routine.timezoneMove.settingFailed", { server: target.name }));
      if (failed > 0) {
        actionToast.warning(
          text.t("routine.timezoneMove.partial", { count: failed, server: target.name, zone: zoneLabel(to) }),
        );
      } else if (moved > 0) {
        actionToast.success(
          text.t("routine.timezoneMove.moved", { count: moved, server: target.name, zone: zoneLabel(to) }),
        );
      }
    } catch (error) {
      actionToast.error(text.errorMessage(error, text.t("routine.timezoneMove.failed")));
    } finally {
      moving.delete(target.id);
    }
    await check(target);
  }

  /** The device zone of the last check of every server. */
  let checkedZone = deviceZone();

  function checkAll(): void {
    const zone = deviceZone();
    if (zone !== checkedZone) dismissed.clear();
    checkedZone = zone;
    const current = untrack(targets);
    for (const serverId of shown.keys()) {
      if (current.some((target) => target.id === serverId)) continue;
      shown.delete(serverId);
      toast.dismiss(toastId(serverId));
    }
    for (const target of current) void check(target);
  }

  createEffect(
    () =>
      targets()
        .map((target) => target.id)
        .join("\n"),
    () => checkAll(),
  );
  // A focus reads every server only after the device zone changed. Otherwise it reads only the servers
  // with a prompt, so a prompt closes when another device moved those routines.
  const recheck = () => {
    if (document.visibilityState !== "visible") return;
    if (deviceZone() !== checkedZone) {
      checkAll();
      return;
    }
    for (const target of untrack(targets)) {
      if (shown.has(target.id)) void check(target);
    }
  };
  window.addEventListener("focus", recheck);
  document.addEventListener("visibilitychange", recheck);
  onCleanup(() => {
    window.removeEventListener("focus", recheck);
    document.removeEventListener("visibilitychange", recheck);
    for (const serverId of shown.keys()) toast.dismiss(toastId(serverId));
  });
}
