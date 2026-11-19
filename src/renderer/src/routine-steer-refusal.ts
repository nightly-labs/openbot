import { matchingSourceKeys } from "@openbot/i18n";
import { normalizeMessage } from "@openbot/user-errors/reference";

export function isRoutineSteerRefusal(error: unknown): boolean {
  return matchingSourceKeys(normalizeMessage(error))[0] === "error.backend.steerRoutineRun";
}
