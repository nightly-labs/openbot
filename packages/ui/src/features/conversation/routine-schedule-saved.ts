import type { RoutineSchedule } from "@openbot/contracts/ipc";
import type { AppTextKey, AppTranslate } from "@openbot/i18n";
import { routineOnceInstant } from "@openbot/team-client/routine-schedule";
import {
  type RoutineDraftProblem,
  type RoutineScheduleDraft,
  routineDraftProblemCode,
} from "@openbot/team-client/routine-schedule-draft";
import { currentText } from "../../text";
import { ROUTINE_DRAFT_KINDS } from "./routine-schedule-draft";

// The conversion between a draft and a saved schedule is shared with the phone.
export { routineScheduleFromDraft, routineScheduleToDraft } from "@openbot/team-client/routine-schedule-draft";

/**
 * The kinds every host saves. Only this computer's host saves `once`: the released Team API
 * cannot carry it.
 */
export const ROUTINE_SAVED_DRAFT_KINDS = ROUTINE_DRAFT_KINDS.filter((option) => option.value !== "once");

/** The kinds this computer's host saves. */
export const ROUTINE_LOCAL_DRAFT_KINDS = ROUTINE_DRAFT_KINDS;

const PROBLEM_TEXT = {
  invalidDate: "routine.problem.invalidDate",
  cronRequired: "routine.problem.cronRequired",
  cronTooLong: "routine.problem.cronTooLong",
} as const satisfies Record<RoutineDraftProblem, AppTextKey>;

/** Why the draft cannot be saved, or `null`. A save of such a draft would change when it runs. */
export function routineDraftProblem(draft: RoutineScheduleDraft, t: AppTranslate = currentText().t): string | null {
  const problem = routineDraftProblemCode(draft);
  return problem ? t(PROBLEM_TEXT[problem]) : null;
}

/** The time of a one-time schedule has passed. Other kinds have no last time. */
export function routineOncePassed(schedule: RoutineSchedule, timezone: string, now = new Date()): boolean {
  return schedule.kind === "once" && routineOnceInstant(schedule, timezone).getTime() <= now.getTime();
}

/**
 * A one-time routine that the host finished: the host paused it at or after its time, after the run
 * or after it recorded the run as missed. A routine that the person paused before its time stays
 * "paused" after that time. An edit after that time marks it done too: the record keeps no other sign.
 */
export function routineOnceCompleted(routine: {
  active: boolean;
  timezone: string;
  schedule: RoutineSchedule;
  updatedAt: string;
}): boolean {
  if (routine.active || routine.schedule.kind !== "once") return false;
  return Date.parse(routine.updatedAt) >= routineOnceInstant(routine.schedule, routine.timezone).getTime();
}
