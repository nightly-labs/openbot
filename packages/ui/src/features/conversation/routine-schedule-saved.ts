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

export { routineScheduleFromDraft, routineScheduleToDraft } from "@openbot/team-client/routine-schedule-draft";

export const ROUTINE_SAVED_DRAFT_KINDS = ROUTINE_DRAFT_KINDS.filter((option) => option.value !== "once");

export const ROUTINE_LOCAL_DRAFT_KINDS = ROUTINE_DRAFT_KINDS;

const PROBLEM_TEXT = {
  invalidDate: "routine.problem.invalidDate",
  cronRequired: "routine.problem.cronRequired",
  cronTooLong: "routine.problem.cronTooLong",
} as const satisfies Record<RoutineDraftProblem, AppTextKey>;

export function routineDraftProblem(draft: RoutineScheduleDraft, t: AppTranslate = currentText().t): string | null {
  const problem = routineDraftProblemCode(draft);
  return problem ? t(PROBLEM_TEXT[problem]) : null;
}

export function routineOncePassed(schedule: RoutineSchedule, timezone: string, now = new Date()): boolean {
  return schedule.kind === "once" && routineOnceInstant(schedule, timezone).getTime() <= now.getTime();
}

export function routineOnceCompleted(routine: {
  active: boolean;
  timezone: string;
  schedule: RoutineSchedule;
  updatedAt: string;
}): boolean {
  if (routine.active || routine.schedule.kind !== "once") return false;
  return Date.parse(routine.updatedAt) >= routineOnceInstant(routine.schedule, routine.timezone).getTime();
}
