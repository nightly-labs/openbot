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

export function quietTurnEvent(value: unknown): QuietTurnCompletedEvent | null {
  if (!isDynamicRecord(value) || value.type !== "quiet-turn-completed") return null;
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
