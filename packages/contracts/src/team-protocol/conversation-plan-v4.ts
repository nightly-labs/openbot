import { isConversationPlan } from "../ipc-conversation-plan";
import { isDynamicRecord, isString } from "../runtime-values";
import type { TeamProtocolV4BaseJsonObject, TeamProtocolV4BaseJsonValue } from "./v4-base";

export function withConversationPlans(
  projected: TeamProtocolV4BaseJsonValue,
  source: unknown,
): TeamProtocolV4BaseJsonValue {
  if (!isDynamicRecord(projected) || !isDynamicRecord(source)) return projected;
  const plans = new Map<string, TeamProtocolV4BaseJsonValue>();
  for (const message of [
    ...(Array.isArray(source.messages) ? source.messages : []),
    ...(isDynamicRecord(source.references) ? Object.values(source.references) : []),
  ]) {
    if (!isDynamicRecord(message) || message.plan === undefined) continue;
    if (!isConversationPlan(message.plan)) throw new Error("Invalid conversation plan.");
    if (isString(message.id)) plans.set(message.id, JSON.parse(JSON.stringify(message.plan)));
  }
  if (plans.size === 0) return projected;
  const withPlan = (message: TeamProtocolV4BaseJsonValue): TeamProtocolV4BaseJsonValue => {
    if (!isDynamicRecord(message) || !isString(message.id)) return message;
    const plan = plans.get(message.id);
    return plan === undefined ? message : { ...message, plan };
  };
  const result: TeamProtocolV4BaseJsonObject = { ...projected };
  if (Array.isArray(result.messages)) result.messages = result.messages.map(withPlan);
  if (isDynamicRecord(result.references)) {
    result.references = Object.fromEntries(
      Object.entries(result.references).map(([id, value]) => [id, withPlan(value)]),
    );
  }
  return result;
}

export function eventConversationKey(type: unknown): "snapshot" | "page" | null {
  return type === "conversation" ? "snapshot" : type === "conversation-page" ? "page" : null;
}
