import type { RoutineFields, RoutineSchedule } from "@openbot/contracts/ipc";
import { errorMessage } from "@openbot/ui/error-message";
import {
  RoutineScheduleCard,
  type RoutineScheduleCardState,
} from "@openbot/ui/features/conversation/RoutineScheduleCard";
import type { RoutineScheduleDraft } from "@openbot/ui/features/conversation/routine-schedule-draft";
import {
  ROUTINE_SAVED_DRAFT_KINDS,
  routineDraftProblem,
  routineScheduleFromDraft,
  routineScheduleToDraft,
} from "@openbot/ui/features/conversation/routine-schedule-saved";
import { createEffect, createSignal } from "solid-js";
import { agentRoutinesPort } from "./routines-port";

export interface RoutineChatCardProps {
  action: "created" | "updated";
  /** The chat shows the plain marker for a routine that no longer exists: its schedule is unknown. */
  routine: RoutineFields;
  agentId: string;
  /** False when a later card in this chat is for the same routine. */
  latest: boolean;
  onOpenRoutine: (routine: { routineId: string; name: string }) => void;
  onShowLatest?: () => void;
  /** "Show latest" on an older card moved here, so the card takes keyboard focus once it is in the page. */
  focusRequested?: boolean;
  onFocusHandled?: () => void;
}

type CardSave =
  | { status: "idle" }
  | { status: "saving" }
  | { status: "saved"; routine: RoutineFields; undo: RoutineSchedule | null }
  | { status: "error"; message: string };

/**
 * The chat record of a routine the agent created or changed. The person can move its schedule
 * here; the change saves at once, like a chip in the settings panel followed by Save.
 */
export function RoutineChatCard(props: RoutineChatCardProps) {
  const [save, setSave] = createSignal<CardSave>({ status: "idle" });
  // The save result is newer than the routine list until the list loads again.
  const routine = () => {
    const current = save();
    if (current.status !== "saved") return props.routine;
    return current.routine.updatedAt > props.routine.updatedAt ? current.routine : props.routine;
  };
  const [draft, setDraft] = createSignal<RoutineScheduleDraft>(routineScheduleToDraft(props.routine.trigger.schedule));
  // The edit in progress. It saves when the edit ends; signal reads lag behind writes, so the
  // save reads this and not `draft()`.
  let pending: RoutineScheduleDraft | undefined;
  createEffect(
    () => routine().trigger.schedule,
    (schedule) => {
      // A list refresh while a popover is open must not undo the edit shown in it.
      if (!pending) setDraft(routineScheduleToDraft(schedule));
    },
  );
  const [element, setElement] = createSignal<HTMLElement>();
  createEffect(
    () => (props.focusRequested ? element() : undefined),
    (card) => {
      if (!card) return;
      card.querySelector<HTMLButtonElement>("button:not(:disabled)")?.focus();
      props.onFocusHandled?.();
    },
  );
  let saveRequest = 0;
  // Saves run one after another, so a slow host cannot apply an older schedule last.
  let saveQueue = Promise.resolve();

  function saveSchedule(schedule: RoutineSchedule, undo: RoutineSchedule | null): void {
    const request = ++saveRequest;
    setSave({ status: "saving" });
    saveQueue = saveQueue.then(() => sendSchedule(schedule, undo, request));
  }

  async function sendSchedule(schedule: RoutineSchedule, undo: RoutineSchedule | null, request: number) {
    // Read when the save starts, so it keeps a rename or a pause that an earlier save loaded.
    const current = routine();
    try {
      const saved = await agentRoutinesPort(props.agentId).save({
        routineId: current.id,
        name: current.name,
        instruction: current.instruction,
        active: current.active,
        timezone: current.timezone,
        schedule,
      });
      if (request === saveRequest) setSave({ status: "saved", routine: saved, undo });
    } catch (caught) {
      if (request !== saveRequest) return;
      setSave({ status: "error", message: errorMessage(caught, "Could not save the schedule.") });
      setDraft(routineScheduleToDraft(routine().trigger.schedule));
    }
  }

  const state = (): RoutineScheduleCardState => (props.latest ? save().status : "superseded");
  const undo = () => {
    const current = save();
    return current.status === "saved" ? current.undo : null;
  };
  const errorText = () => {
    const current = save();
    return current.status === "error" ? current.message : undefined;
  };

  return (
    <RoutineScheduleCard
      action={props.action}
      routineName={routine().name}
      schedule={draft()}
      kinds={ROUTINE_SAVED_DRAFT_KINDS}
      state={state()}
      errorText={errorText()}
      nextRunLabel={nextRunLabel(routine())}
      timeZoneLabel={timeZoneLabel(routine())}
      onChange={(next) => {
        pending = next;
        setDraft(next);
      }}
      onEditEnd={() => {
        const next = pending;
        pending = undefined;
        if (!next) return;
        const problem = routineDraftProblem(next);
        if (problem) {
          // Keep the edit on screen, so the person can correct it.
          pending = next;
          setSave({ status: "error", message: problem });
          return;
        }
        const previous = routine().trigger.schedule;
        const schedule = routineScheduleFromDraft(next);
        // A pick of the same value, or a change and a change back, keeps the saved schedule.
        if (sameSchedule(schedule, routineScheduleFromDraft(routineScheduleToDraft(previous)))) return;
        saveSchedule(schedule, previous);
      }}
      onOpenRoutine={() => props.onOpenRoutine({ routineId: routine().id, name: routine().name })}
      onUndo={
        undo()
          ? () => {
              const previous = undo();
              if (previous) saveSchedule(previous, null);
            }
          : undefined
      }
      onShowLatest={props.onShowLatest}
      elementRef={setElement}
    />
  );
}

/** Both come from `routineScheduleFromDraft`, so their keys are in the same order. */
function sameSchedule(left: RoutineSchedule, right: RoutineSchedule): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}

function localTimeZone(): string {
  return Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
}

/** "Thu, Sep 25 at 8:20 AM", in the zone the routine runs in. */
function nextRunLabel(routine: RoutineFields): string | undefined {
  const nextRunAt = routine.trigger.nextRunAt;
  if (!routine.active || !nextRunAt) return undefined;
  const date = new Date(nextRunAt);
  if (Number.isNaN(date.getTime())) return undefined;
  const timeZone = knownTimeZone(routine.timezone) ?? localTimeZone();
  const day = new Intl.DateTimeFormat(undefined, { weekday: "short", month: "short", day: "numeric", timeZone });
  const time = new Intl.DateTimeFormat(undefined, { hour: "numeric", minute: "2-digit", timeZone });
  return `${day.format(date)} at ${time.format(date)}`;
}

/** "Warsaw time", only when the routine does not run in the viewer's zone. */
function timeZoneLabel(routine: RoutineFields): string | undefined {
  const timeZone = knownTimeZone(routine.timezone);
  if (!timeZone || timeZone === localTimeZone()) return undefined;
  const city = timeZone.split("/").at(-1)?.replaceAll("_", " ");
  return `${city ?? timeZone} time`;
}

function knownTimeZone(timeZone: string | undefined): string | undefined {
  if (!timeZone) return undefined;
  try {
    new Intl.DateTimeFormat(undefined, { timeZone });
    return timeZone;
  } catch {
    return undefined;
  }
}
