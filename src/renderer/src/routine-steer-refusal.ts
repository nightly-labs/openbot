import { matchingSourceKeys } from "@openbot/i18n";
import { normalizeMessage } from "@openbot/user-errors/reference";

/**
 * The host refused to steer a message into a routine run, which has its own provider session. The
 * message waits in the queue and its row says why, so the refusal is not an error to show.
 */
export function isRoutineSteerRefusal(error: unknown): boolean {
  return matchingSourceKeys(normalizeMessage(error))[0] === "error.backend.steerRoutineRun";
}
