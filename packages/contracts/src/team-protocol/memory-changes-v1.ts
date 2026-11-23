import { isConversationMemoryChanges } from "../ipc-conversation-memory-changes";
import { isDynamicRecord, isString } from "../runtime-values";
import type { TeamProtocolV7BaseJsonObject, TeamProtocolV7BaseJsonValue } from "./v7-base";

export const TEAM_MEMORY_CHANGES_CAPABILITY = "memory-changes-v1";

const CONVERSATION_MEMORY_CHANGES_WIRE_BUDGET = 1_000_000;

export function withConversationMemoryChanges(
  projected: TeamProtocolV7BaseJsonValue,
  source: unknown,
): TeamProtocolV7BaseJsonValue {
  if (!isDynamicRecord(projected) || !isDynamicRecord(source)) return projected;
  const fromMessages = Array.isArray(source.messages) ? source.messages : [];
  const fromReferences = isDynamicRecord(source.references) ? Object.values(source.references) : [];
  const candidates: Array<{ id: string; changes: TeamProtocolV7BaseJsonValue; size: number }> = [];
  for (const message of [...[...fromMessages].reverse(), ...fromReferences]) {
    if (!isDynamicRecord(message) || message.memoryChanges === undefined) continue;
    if (!isConversationMemoryChanges(message.memoryChanges)) throw new Error("Invalid conversation memory changes.");
    const json = JSON.stringify(
      message.memoryChanges.map((change) => ({
        memoryId: change.memoryId,
        action: change.action,
        text: change.text,
        ...(change.previousText === undefined ? {} : { previousText: change.previousText }),
      })),
    );
    if (isString(message.id)) candidates.push({ id: message.id, changes: JSON.parse(json), size: json.length });
  }
  if (candidates.length === 0) return projected;
  const lists = new Map<string, TeamProtocolV7BaseJsonValue>();
  let used = 0;
  for (const candidate of candidates) {
    if (lists.has(candidate.id) || used + candidate.size > CONVERSATION_MEMORY_CHANGES_WIRE_BUDGET) continue;
    lists.set(candidate.id, candidate.changes);
    used += candidate.size;
  }
  const withChanges = (message: TeamProtocolV7BaseJsonValue): TeamProtocolV7BaseJsonValue => {
    if (!isDynamicRecord(message) || !isString(message.id)) return message;
    const changes = lists.get(message.id);
    return changes === undefined ? message : { ...message, memoryChanges: changes };
  };
  const result: TeamProtocolV7BaseJsonObject = { ...projected };
  if (Array.isArray(result.messages)) result.messages = result.messages.map(withChanges);
  if (isDynamicRecord(result.references)) {
    result.references = Object.fromEntries(
      Object.entries(result.references).map(([id, value]) => [id, withChanges(value)]),
    );
  }
  return result;
}
