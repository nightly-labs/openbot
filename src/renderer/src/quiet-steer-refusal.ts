import { matchingSourceKeys } from "@openbot/i18n";
import { normalizeMessage } from "@openbot/user-errors/reference";

const QUIET_STEER_REFUSALS: ReadonlySet<string> = new Set([
  "error.backend.steerRoutineRun",
  "error.backend.steerTurnChanged",
]);

export function isQuietSteerRefusal(error: unknown): boolean {
  const key = matchingSourceKeys(normalizeMessage(error))[0];
  return key !== undefined && QUIET_STEER_REFUSALS.has(key);
}
