import { isConversationMemoryChanges } from "../ipc-conversation-memory-changes";
import { isDynamicRecord, isString } from "../runtime-values";
import type { TeamProtocolV7BaseJsonObject, TeamProtocolV7BaseJsonValue } from "./v7-base";

/**
 * Frozen optional memory-changes-v1 contract: the memory changes that one turn committed. It adds
 * `memoryChanges` (a `ConversationMemoryChange[]`, see `ipc-conversation-memory-changes.ts`) beside
 * the frozen keys of a message in:
 *
 * - `messages` and `references` of `GET /v1/agents/:agentId/conversation` and
 *   `GET /v1/agents/:agentId/conversation-page`;
 * - the `snapshot` of a `conversation` event and the `page` of a `conversation-page` event.
 *
 * The host adds it only for a client that advertises the capability. It is a protocol 9 capability
 * only, and it uses the protocol 8 wire. A client without it reads the message as before: a
 * `memory-changes` system message whose text counts the changes. A host without the capability never
 * sends `memoryChanges`, so a client accepts it whenever it is present. A present list that
 * `isConversationMemoryChanges` refuses fails closed; the host stores only lists it accepts. The task
 * conversations of agent-tasks-v1 do not carry it. Widening any of it needs a second capability
 * string.
 */
export const TEAM_MEMORY_CHANGES_CAPABILITY = "memory-changes-v1";

/**
 * All the memory change lists of one snapshot, page or event together, as `JSON.stringify` writes
 * them, in UTF-16 code units. One list is bounded by `CONVERSATION_MEMORY_CHANGE_LIMIT`, but a page
 * carries up to a hundred messages and their references. The newest lists are kept up to this
 * budget, and an older list over it is left out: its message still has the count text.
 */
const CONVERSATION_MEMORY_CHANGES_WIRE_BUDGET = 1_000_000;

/** `projected` with the memory changes of each message of `source` that has them, within the wire budget. */
export function withConversationMemoryChanges(
  projected: TeamProtocolV7BaseJsonValue,
  source: unknown,
): TeamProtocolV7BaseJsonValue {
  if (!isDynamicRecord(projected) || !isDynamicRecord(source)) return projected;
  const fromMessages = Array.isArray(source.messages) ? source.messages : [];
  const fromReferences = isDynamicRecord(source.references) ? Object.values(source.references) : [];
  // Messages run oldest first, so the budget goes to the newest messages first.
  const candidates: Array<{ id: string; changes: TeamProtocolV7BaseJsonValue; size: number }> = [];
  for (const message of [...[...fromMessages].reverse(), ...fromReferences]) {
    if (!isDynamicRecord(message) || message.memoryChanges === undefined) continue;
    if (!isConversationMemoryChanges(message.memoryChanges)) throw new Error("Invalid conversation memory changes.");
    // Only the known keys of each change go out.
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
