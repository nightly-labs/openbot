import { INPUT_LIMITS } from "./input-limits";
import { isBoundedString, isIdentifier } from "./ipc-bounded-values";
import { isDynamicRecord } from "./runtime-values";

export interface AgentWait {
  id: string;
  agentId: string;
  note: string;
  requestMessageId: string;
  requestText: string;
  routineId: string | null;
  createdAt: string;
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
