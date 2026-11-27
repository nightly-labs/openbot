import { INPUT_LIMITS } from "@openbot/contracts/input-limits";
import type { ConversationMessage } from "@openbot/contracts/ipc";
import { isConversationMessage, isConversationTurnTrace } from "@openbot/contracts/ipc";
import { isBoolean, isDynamicRecord, isNumber, isString } from "@openbot/contracts/runtime-values";

const LEGACY_MESSAGE_KEYS: Readonly<Record<string, string>> = {
  botId: "agentId",
  recipientBotId: "recipientAgentId",
  recipientBotIds: "recipientAgentIds",
  senderBotId: "senderAgentId",
};

export function currentConversationMessage(value: unknown): ConversationMessage | null {
  if (isDynamicRecord(value) && value.senderBotId === undefined && isConversationMessage(value)) return value;
  const current = withoutInvalidTrace(withRoutineNameInLimit(withoutEmptyReplyIds(toCurrentKeys(value))));
  return isConversationMessage(current) ? current : null;
}

function withoutInvalidTrace(value: JsonValue): JsonValue {
  if (!isDynamicRecord(value) || value.trace === undefined || isConversationTurnTrace(value.trace)) return value;
  const { trace: _dropped, ...message } = value;
  return message;
}

function withoutEmptyReplyIds(value: JsonValue): JsonValue {
  if (!isDynamicRecord(value)) return value;
  const { exchange } = value;
  return {
    ...value,
    ...(value.replyToMessageId === "" ? { replyToMessageId: null } : {}),
    ...(isDynamicRecord(exchange) && exchange.replyToMessageId === ""
      ? { exchange: { ...exchange, replyToMessageId: null } }
      : {}),
  };
}

function withRoutineNameInLimit(value: JsonValue): JsonValue {
  if (!isDynamicRecord(value) || !isDynamicRecord(value.routine) || !isString(value.routine.name)) return value;
  return { ...value, routine: { ...value.routine, name: routineNameInLimit(value.routine.name) } };
}

export function routineNameInLimit(name: string): string {
  if (name.length <= INPUT_LIMITS.routineName) return name;
  const start = name.slice(0, INPUT_LIMITS.routineName);
  const last = start.charCodeAt(start.length - 1);
  return last >= 0xd800 && last <= 0xdbff ? start.slice(0, -1) : start;
}

type JsonValue = string | number | boolean | null | JsonValue[] | { [key: string]: JsonValue };

function toCurrentKeys(value: unknown): JsonValue {
  if (Array.isArray(value)) return value.map(toCurrentKeys);
  if (isDynamicRecord(value)) {
    const result: Record<string, JsonValue> = {};
    for (const [key, entry] of Object.entries(value)) {
      const current = LEGACY_MESSAGE_KEYS[key] ?? key;
      if (current !== key && value[current] !== undefined) continue;
      result[current] = key === "kind" && entry === "bot" ? "agent" : toCurrentKeys(entry);
    }
    return result;
  }
  return isString(value) || isNumber(value) || isBoolean(value) ? value : null;
}
