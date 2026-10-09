// Optional quiet-turn-v1 wire contract. Keep IPC types and limits out of this file.
// A capable client receives this instead of turn-completed for a routine with no news.
// A client without the capability receives the released turn-completed event.
import { isDynamicRecord, isString } from "../runtime-values";

export const QUIET_TURN_CAPABILITY = "quiet-turn-v1";

export interface QuietTurnCompletedEvent {
  type: "quiet-turn-completed";
  agentId: string;
  threadId: string;
  turnId: string;
  status: string;
  origin?: "user" | "routine" | "agent" | "unknown";
}

/** Unknown event types return null. A malformed known event throws. */
export function quietTurnEvent(value: unknown): QuietTurnCompletedEvent | null {
  if (!isDynamicRecord(value) || value.type !== "quiet-turn-completed") return null;
  // Match the released completion fields. Provider identifiers have no smaller per-field limit.
  if (
    !isString(value.agentId) ||
    !isString(value.threadId) ||
    !isString(value.turnId) ||
    !isString(value.status) ||
    (value.origin !== undefined &&
      value.origin !== "user" &&
      value.origin !== "routine" &&
      value.origin !== "agent" &&
      value.origin !== "unknown")
  )
    throw new Error("Invalid quiet turn completion.");
  return {
    type: "quiet-turn-completed",
    agentId: value.agentId,
    threadId: value.threadId,
    turnId: value.turnId,
    status: value.status,
    ...(value.origin === undefined ? {} : { origin: value.origin }),
  };
}
