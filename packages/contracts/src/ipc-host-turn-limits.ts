/**
 * The turn limits of a host (`host-turn-limits-v1`), as the desktop main process, the preload and the
 * browser client read them. On the wire the route codec has already checked their fields; this gives
 * them their IPC types and fails closed on anything else.
 */

import { isHostAgentTaskLimit } from "./ipc-agent-tasks";
import { integerInRange } from "./ipc-bounded-values";
import { isDynamicRecord } from "./runtime-values";

/** The most agent turns that an owner or admin can let run at the same time on one host. */
export const HOST_TURN_LIMIT_MAX = 128;
/** A turn limit that an owner or admin set: a number, or no limit even where memory sets one. */
export type HostTurnLimit = number | "unlimited";
/** The automatic value follows the memory of a server, which can be larger than any set value. */
const AUTOMATIC_TURN_LIMIT_MAX = 1_024;

export function isHostTurnLimit(value: unknown): value is HostTurnLimit {
  return value === "unlimited" || integerInRange(value, 1, HOST_TURN_LIMIT_MAX);
}

export interface HostTurnLimits {
  /**
   * The most turns that run at the same time on the host, "unlimited" for no limit, or null for
   * automatic. Low memory on a server still holds a new turn with each value.
   */
  turnLimit: HostTurnLimit | null;
  /** What automatic gives on this host: on a server, a number its memory sets; null for no limit. */
  automaticTurnLimit: number | null;
  /** The task limit of each agent that has no limit of its own, or null for the built-in default. */
  agentTaskLimit: number | null;
  /** The built-in default, `AGENT_TASK_LIMIT_DEFAULT`. */
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
