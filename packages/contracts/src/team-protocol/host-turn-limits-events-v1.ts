import { isDynamicRecord } from "../runtime-values";

export const HOST_TURN_LIMITS_EVENTS_CAPABILITY = "host-turn-limits-events-v1";

export type HostTurnLimitsEvent = { type: "host-turn-limits-changed" };

export function hostTurnLimitsEvent(value: unknown): HostTurnLimitsEvent | null {
  if (!isDynamicRecord(value) || value.type !== "host-turn-limits-changed") return null;
  return { type: "host-turn-limits-changed" };
}
