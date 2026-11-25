import type { RoutineFields, RoutineSchedule } from "@openbot/contracts/ipc";
import { RoutineScheduleCard } from "@openbot/ui/features/conversation/RoutineScheduleCard";
import type { RoutineScheduleDraft } from "@openbot/ui/features/conversation/routine-schedule-draft";
import {
  ROUTINE_LOCAL_DRAFT_KINDS,
  ROUTINE_SAVED_DRAFT_KINDS,
  routineDraftProblem,
  routineOnceCompleted,
  routineOncePassed,
  routineScheduleFromDraft,
  routineScheduleToDraft,
} from "@openbot/ui/features/conversation/routine-schedule-saved";
import { type TextValue, useText } from "@openbot/ui/text";
import { createEffect, createSignal } from "solid-js";
import { knownTimeZone, localTimeZone, routinePausedByRunLabel, routineTimeZoneLabel } from "./routine-summary";
import { agentRoutinesPort } from "./routines-port";

export interface RoutineChatCardProps {
  action: "created" | "updated";
  routine: RoutineFields;
  agentId: string;
  onOpenRoutine: (routine: { routineId: string; name: string }) => void;
}

type CardSave = { status: "idle" } | { status: "saving" } | { status: "saved" } | { status: "error"; message: string };

export function RoutineChatCard(props: RoutineChatCardProps) {
  const text = useText();
  const [save, setSave] = createSignal<CardSave>({ status: "idle" });
  const [lastSaved, setLastSaved] = createSignal<RoutineFields>();
  const routine = () => {
    const saved = lastSaved();
    return saved && saved.updatedAt > props.routine.updatedAt ? saved : props.routine;
  };
  const [draft, setDraft] = createSignal<RoutineScheduleDraft>(routineScheduleToDraft(props.routine.trigger.schedule));
  let pending: RoutineScheduleDraft | undefined;
  createEffect(
    () => (save().status === "saving" ? undefined : routine().trigger.schedule),
    (schedule) => {
      if (schedule && !pending) setDraft(routineScheduleToDraft(schedule));
    },
  );
  let saveRequest = 0;
  let requested: RoutineSchedule | undefined;
  let saveQueue = Promise.resolve();

  function saveSchedule(schedule: RoutineSchedule): void {
    const request = ++saveRequest;
    requested = schedule;
    setSave({ status: "saving" });
    saveQueue = saveQueue.then(() => sendSchedule(schedule, request));
  }

  async function sendSchedule(schedule: RoutineSchedule, request: number) {
    const current = routine();
    const done = routineOnceCompleted({ ...current, schedule: current.trigger.schedule });
    const later = !routineOncePassed(schedule, current.timezone);
    try {
      const { routine: saved } = await agentRoutinesPort(props.agentId).save({
        routineId: current.id,
        name: current.name,
        instruction: current.instruction,
        active: current.active || (done && later),
        timezone: current.timezone,
        schedule,
      });
      if (!("owner" in saved)) setLastSaved(saved);
      if (request !== saveRequest) return;
      requested = undefined;
      setSave({ status: "saved" });
    } catch (caught) {
      if (request !== saveRequest) return;
      requested = undefined;
      setSave({ status: "error", message: text.errorMessage(caught, text.t("routine.card.saveFailed")) });
      setDraft(routineScheduleToDraft(routine().trigger.schedule));
    }
  }

  const errorText = () => {
    const current = save();
    return current.status === "error" ? current.message : undefined;
  };

  return (
    <RoutineScheduleCard
      action={props.action}
      routineName={routine().name}
      schedule={draft()}
      kinds={routine().trigger.schedule.kind === "once" ? ROUTINE_LOCAL_DRAFT_KINDS : ROUTINE_SAVED_DRAFT_KINDS}
      state={save().status}
      errorText={errorText()}
      nextRunLabel={nextRunLabel(routine(), text)}
      timeZoneLabel={routineTimeZoneLabel(routine(), text)}
      pausedLabel={pausedLabel(routine(), text)}
      onChange={(next) => {
        pending = next;
        setDraft(next);
      }}
      onEditEnd={() => {
        const next = pending;
        pending = undefined;
        if (!next) return;
        const problem = routineDraftProblem(next, text.t);
        if (problem) {
          pending = next;
          setSave({ status: "error", message: problem });
          return;
        }
        const current = requested ?? routineScheduleFromDraft(routineScheduleToDraft(routine().trigger.schedule));
        const schedule = routineScheduleFromDraft(next);
        if (sameSchedule(schedule, current)) return;
        saveSchedule(schedule);
      }}
      onOpenRoutine={() => props.onOpenRoutine({ routineId: routine().id, name: routine().name })}
    />
  );
}

function sameSchedule(left: RoutineSchedule, right: RoutineSchedule): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}

function pausedLabel(routine: RoutineFields, text: Pick<TextValue, "t" | "format">): string | undefined {
  if (routine.active) return undefined;
  const pausedByRun = routinePausedByRunLabel(routine, text);
  if (pausedByRun) return pausedByRun;
  if (routineOnceCompleted({ ...routine, schedule: routine.trigger.schedule })) return undefined;
  return text.t("routine.settings.paused");
}

function nextRunLabel(routine: RoutineFields, text: Pick<TextValue, "t" | "format">): string | undefined {
  const nextRunAt = routine.trigger.nextRunAt;
  if (!routine.active || !nextRunAt) return undefined;
  const date = new Date(nextRunAt);
  if (Number.isNaN(date.getTime())) return undefined;
  const timeZone = knownTimeZone(routine.timezone) ?? localTimeZone();
  const day = text.format.date(date, { weekday: "short", month: "short", day: "numeric", timeZone });
  const time = text.format.date(date, { hour: "numeric", minute: "2-digit", timeZone });
  return text.t("routine.card.nextRunAt", { day, time });
}
