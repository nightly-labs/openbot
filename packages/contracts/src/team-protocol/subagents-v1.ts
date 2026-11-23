import { clampConversationSubagents, isConversationSubagents } from "../ipc-conversation-subagents";
import { isDynamicRecord, isString } from "../runtime-values";
import type { TeamProtocolV7BaseJsonObject, TeamProtocolV7BaseJsonValue } from "./v7-base";

export const TEAM_SUBAGENTS_CAPABILITY = "subagents-v1";

const CONVERSATION_SUBAGENTS_WIRE_BUDGET = 1_000_000;

export function withConversationSubagents(
  projected: TeamProtocolV7BaseJsonValue,
  source: unknown,
): TeamProtocolV7BaseJsonValue {
  if (!isDynamicRecord(projected) || !isDynamicRecord(source)) return projected;
  const fromMessages = Array.isArray(source.messages) ? source.messages : [];
  const fromReferences = isDynamicRecord(source.references) ? Object.values(source.references) : [];
  const candidates: Array<{ id: string; subagents: TeamProtocolV7BaseJsonValue; size: number }> = [];
  for (const message of [...[...fromMessages].reverse(), ...fromReferences]) {
    if (!isDynamicRecord(message) || message.subagents === undefined) continue;
    if (!isConversationSubagents(message.subagents)) throw new Error("Invalid conversation subagents.");
    const json = JSON.stringify(clampConversationSubagents(message.subagents) ?? []);
    if (isString(message.id)) candidates.push({ id: message.id, subagents: JSON.parse(json), size: json.length });
  }
  if (candidates.length === 0) return projected;
  const lists = new Map<string, TeamProtocolV7BaseJsonValue>();
  let used = 0;
  for (const candidate of candidates) {
    if (lists.has(candidate.id) || used + candidate.size > CONVERSATION_SUBAGENTS_WIRE_BUDGET) continue;
    lists.set(candidate.id, candidate.subagents);
    used += candidate.size;
  }
  const withSubagents = (message: TeamProtocolV7BaseJsonValue): TeamProtocolV7BaseJsonValue => {
    if (!isDynamicRecord(message) || !isString(message.id)) return message;
    const subagents = lists.get(message.id);
    return subagents === undefined ? message : { ...message, subagents };
  };
  const result: TeamProtocolV7BaseJsonObject = { ...projected };
  if (Array.isArray(result.messages)) result.messages = result.messages.map(withSubagents);
  if (isDynamicRecord(result.references)) {
    result.references = Object.fromEntries(
      Object.entries(result.references).map(([id, value]) => [id, withSubagents(value)]),
    );
  }
  return result;
}
