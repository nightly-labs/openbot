import { clampConversationSubagents, isConversationSubagents } from "../ipc-conversation-subagents";
import { isDynamicRecord, isString } from "../runtime-values";
import type { TeamProtocolV7BaseJsonObject, TeamProtocolV7BaseJsonValue } from "./v7-base";

/**
 * Frozen optional subagents-v1 contract: the subagents that an agent started in one turn. It adds
 * `subagents` (a `ConversationSubagent[]`, see `ipc-conversation-subagents.ts`) beside the frozen keys
 * of a message in:
 *
 * - `messages` and `references` of `GET /v1/agents/:agentId/conversation` and
 *   `GET /v1/agents/:agentId/conversation-page`;
 * - the `snapshot` of a `conversation` event and the `page` of a `conversation-page` event.
 *
 * The host adds it only for a client that advertises the capability, on protocol 7, so the wire of
 * every released client stays as it was. Such a client reads the message as its fallback: a
 * `subagents` message whose text lists the subagents by title. A host without the capability never
 * sends `subagents`, so a client accepts it whenever it is present. A present list that
 * `isConversationSubagents` refuses fails closed; the host stores only lists it accepts. The list goes
 * out through `clampConversationSubagents`, with only known keys. The task conversations of
 * agent-tasks-v1 do not carry it. Widening any of it needs a second capability string.
 */
export const TEAM_SUBAGENTS_CAPABILITY = "subagents-v1";

/**
 * All the subagent lists of one snapshot, page or event together, as `JSON.stringify` writes them, in
 * UTF-16 code units. One list is already bounded by the contract (`CONVERSATION_SUBAGENT_LIMIT` and
 * `CONVERSATION_SUBAGENT_STEP_LIMIT`), but a page carries up to a hundred messages and their
 * references. The newest lists are kept up to this budget, and an older list over it is left out: its
 * message still has the fallback text.
 */
const CONVERSATION_SUBAGENTS_WIRE_BUDGET = 1_000_000;

/** `projected` with the subagents of each message of `source` that has them, within the wire budget. */
export function withConversationSubagents(
  projected: TeamProtocolV7BaseJsonValue,
  source: unknown,
): TeamProtocolV7BaseJsonValue {
  if (!isDynamicRecord(projected) || !isDynamicRecord(source)) return projected;
  const fromMessages = Array.isArray(source.messages) ? source.messages : [];
  const fromReferences = isDynamicRecord(source.references) ? Object.values(source.references) : [];
  // Messages run oldest first, so the budget goes to the newest messages first. A page names the
  // messages its replies point at separately; those come last.
  const candidates: Array<{ id: string; subagents: TeamProtocolV7BaseJsonValue; size: number }> = [];
  for (const message of [...[...fromMessages].reverse(), ...fromReferences]) {
    if (!isDynamicRecord(message) || message.subagents === undefined) continue;
    if (!isConversationSubagents(message.subagents)) throw new Error("Invalid conversation subagents.");
    // The guard accepts an empty list, and the clamp gives null for it.
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
