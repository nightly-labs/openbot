import { isAgentProviderRef } from "../agent-providers";
import { isDynamicRecord } from "../runtime-values";
import type { TeamProtocolV8BaseJsonObject, TeamProtocolV8BaseJsonValue } from "./v8-base";

export const QUEUE_HOLD_CAPABILITY = "queue-hold-v1";
export const QUEUE_HOLD_SIGN_IN_CAPABILITY = "queue-hold-sign-in-v1";

const V1_REASONS = new Set(["provider-restart"]);
const SIGN_IN_REASONS = new Set(["provider-restart", "sign-in"]);

function v1Hold(hold: unknown, sending: boolean, signIn: boolean): TeamProtocolV8BaseJsonObject | null {
  const reasons = signIn ? SIGN_IN_REASONS : V1_REASONS;
  if (!isDynamicRecord(hold) || typeof hold.reason !== "string" || !reasons.has(hold.reason)) return null;
  if (isAgentProviderRef(hold.provider)) return { reason: hold.reason, provider: hold.provider };
  if (sending) return null;
  throw new Error("Invalid queue hold.");
}

export function withQueueHold(
  projected: TeamProtocolV8BaseJsonValue,
  source: unknown,
  sending = false,
  signIn = !sending,
): TeamProtocolV8BaseJsonValue {
  if (!isDynamicRecord(projected) || !Array.isArray(projected.deliveries)) return projected;
  if (!isDynamicRecord(source) || source.hold === undefined || source.hold === null) return projected;
  const hold = v1Hold(source.hold, sending, signIn);
  return hold ? { ...projected, hold } : projected;
}

export function withQueueEventHold(
  projected: TeamProtocolV8BaseJsonValue,
  source: unknown,
  sending = false,
  signIn = !sending,
): TeamProtocolV8BaseJsonValue {
  if (!isDynamicRecord(projected) || projected.type !== "queue-changed" || !isDynamicRecord(source)) return projected;
  if (projected.snapshot === undefined) return projected;
  return { ...projected, snapshot: withQueueHold(projected.snapshot, source.snapshot, sending, signIn) };
}
