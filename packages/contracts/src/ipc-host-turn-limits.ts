import { isHostAgentTaskLimit } from "./ipc-agent-tasks";
import { integerInRange } from "./ipc-bounded-values";
import { isDynamicRecord } from "./runtime-values";

export const HOST_TURN_LIMIT_MAX = 128;
export type HostTurnLimit = number | "unlimited";
const AUTOMATIC_TURN_LIMIT_MAX = 1_024;

export function isHostTurnLimit(value: unknown): value is HostTurnLimit {
  return value === "unlimited" || integerInRange(value, 1, HOST_TURN_LIMIT_MAX);
}

export interface HostTurnLimits {
  turnLimit: HostTurnLimit | null;
  automaticTurnLimit: number | null;
  agentTaskLimit: number | null;
  defaultAgentTaskLimit: number;
}

export interface HostTurnLimitsInput {
  turnLimit: HostTurnLimit | null;
  agentTaskLimit: number | null;
}

function nullableLimit<Limit>(value: unknown, valid: (value: unknown) => value is Limit): Limit | null {
  if (value !== null && !valid(value)) throw new Error("Invalid turn limit.");
  return value;
}

const isAutomaticTurnLimit = (value: unknown): value is number => integerInRange(value, 1, AUTOMATIC_TURN_LIMIT_MAX);

export function decodeHostTurnLimits(value: unknown): HostTurnLimits {
  if (!isDynamicRecord(value) || !isHostAgentTaskLimit(value.defaultAgentTaskLimit))
    throw new Error("Invalid turn limit.");
  return {
    turnLimit: nullableLimit(value.turnLimit, isHostTurnLimit),
    automaticTurnLimit: nullableLimit(value.automaticTurnLimit, isAutomaticTurnLimit),
    agentTaskLimit: nullableLimit(value.agentTaskLimit, isHostAgentTaskLimit),
    defaultAgentTaskLimit: value.defaultAgentTaskLimit,
  };
}

export function parseHostTurnLimitsInput(value: unknown): HostTurnLimitsInput {
  if (!isDynamicRecord(value)) throw new Error("Invalid turn limit.");
  return {
    turnLimit: nullableLimit(value.turnLimit, isHostTurnLimit),
    agentTaskLimit: nullableLimit(value.agentTaskLimit, isHostAgentTaskLimit),
  };
}
