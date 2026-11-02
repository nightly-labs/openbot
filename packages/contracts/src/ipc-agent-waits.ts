import { INPUT_LIMITS } from "./input-limits";
import { isBoundedString, isIdentifier } from "./ipc-bounded-values";
import { isDynamicRecord } from "./runtime-values";

/**
 * Work an agent stopped before it was done, because it waits for something outside the turn. The
 * agent opens the wait with `openbot.await_event`, lists it with `openbot.list_waits` and closes it
 * with `openbot.close_wait`; another local agent can list and close it with `agentId`. The user
 * can cancel it. A routine run of the agent, or a script event that names the wait, wakes it, and
 * the agent continues the request in that run.
 */
export interface AgentWait {
  id: string;
  agentId: string;
  /** What the agent waits for, in its own words. */
  note: string;
  /** The message the wait serves. Its id is the transcript message id. */
  requestMessageId: string;
  requestText: string;
  /** The one routine whose runs wake the wait. Null: every routine run of the agent wakes it. */
  routineId: string | null;
  createdAt: string;
  /** The last run that woke the wait. The wait stays open until the agent closes it. */
  wokenAt: string | null;
  wakeDeliveryId: string | null;
}

export interface AgentWaitsSnapshot {
  agentId: string;
  waits: AgentWait[];
}

export interface CancelAgentWaitInput {
  agentId: string;
  waitId: string;
}

function isAgentWait(value: unknown): value is AgentWait {
  return (
    isDynamicRecord(value) &&
    isIdentifier(value.id) &&
    isIdentifier(value.agentId) &&
    isBoundedString(value.note, INPUT_LIMITS.agentWaitNote) &&
    isIdentifier(value.requestMessageId) &&
    isBoundedString(value.requestText, INPUT_LIMITS.messageText) &&
    (value.routineId === null || isIdentifier(value.routineId)) &&
    isBoundedString(value.createdAt, 160) &&
    (value.wokenAt === null || isBoundedString(value.wokenAt, 160)) &&
    (value.wakeDeliveryId === null || isIdentifier(value.wakeDeliveryId))
  );
}

export function isAgentWaitsSnapshot(value: unknown): value is AgentWaitsSnapshot {
  return (
    isDynamicRecord(value) &&
    isIdentifier(value.agentId) &&
    Array.isArray(value.waits) &&
    value.waits.length <= INPUT_LIMITS.agentWaits &&
    value.waits.every(isAgentWait)
  );
}
