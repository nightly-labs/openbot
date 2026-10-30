import { isDynamicRecord, isString } from "../runtime-values";
import { normalizeConversationUiBlock, type UiBlockState } from "../ui-blocks";
import type { TeamProtocolV7BaseJsonObject, TeamProtocolV7BaseJsonValue } from "./v7-base";

/**
 * Frozen optional ui-blocks-v1 contract: the interactive block of an `ask_ui` question prompt. It adds
 * `uiBlock` (a `ConversationUiBlock`, see `ui-blocks.ts`) beside the frozen keys of a message in:
 *
 * - `messages` and `references` of `GET /v1/agents/:agentId/conversation` and
 *   `GET /v1/agents/:agentId/conversation-page`;
 * - the `snapshot` of a `conversation` event and the `page` of a `conversation-page` event.
 *
 * The host adds it only for a client that advertises the capability, on protocol 7, so the wire of
 * every released client stays as it was. Such a client reads the message as its fallback: a question
 * prompt that it answers through the released prompt route. A host without the capability never
 * sends `uiBlock`, so a client accepts it whenever it is present. A present block that
 * `normalizeConversationUiBlock` refuses fails closed; the host stores only blocks it accepts. The
 * block goes out normalized, with only known keys. Widening any of it needs a second capability string.
 */
export const TEAM_UI_BLOCKS_CAPABILITY = "ui-blocks-v1";

/**
 * All the blocks of one snapshot, page or event together, as `JSON.stringify` writes them, in UTF-16
 * code units. One block is already bounded by the contract (`UI_BLOCK_LIMITS.specJson` and
 * `responseJson`), but a page carries up to a hundred messages and their references. The newest
 * blocks are kept up to this budget, and an older block over it is left out: its message still has
 * the fallback question.
 */
const CONVERSATION_UI_BLOCKS_WIRE_BUDGET = 1_000_000;

/**
 * The state as this capability sends it. `autoAnswer` came later, so it stays off this wire: the client
 * shows the block without the countdown, and the host still answers at its time.
 */
function v1State({ autoAnswer: _autoAnswer, ...state }: UiBlockState): UiBlockState {
  return state;
}

/** `projected` with the block of each message of `source` that has one, within the wire budget. */
export function withConversationUiBlocks(
  projected: TeamProtocolV7BaseJsonValue,
  source: unknown,
): TeamProtocolV7BaseJsonValue {
  if (!isDynamicRecord(projected) || !isDynamicRecord(source)) return projected;
  const fromMessages = Array.isArray(source.messages) ? source.messages : [];
  const fromReferences = isDynamicRecord(source.references) ? Object.values(source.references) : [];
  // Messages run oldest first, so the budget goes to the newest messages first. A page names the
  // messages its replies point at separately, and a quoted reply shows its block; those come last.
  const candidates: Array<{ id: string; block: TeamProtocolV7BaseJsonValue; size: number }> = [];
  for (const message of [...[...fromMessages].reverse(), ...fromReferences]) {
    if (!isDynamicRecord(message) || message.uiBlock === undefined) continue;
    const normalized = normalizeConversationUiBlock(message.uiBlock);
    if (!normalized) throw new Error("Invalid conversation UI block.");
    const json = JSON.stringify({ ...normalized, state: v1State(normalized.state) });
    if (isString(message.id)) candidates.push({ id: message.id, block: JSON.parse(json), size: json.length });
  }
  if (candidates.length === 0) return projected;
  const blocks = new Map<string, TeamProtocolV7BaseJsonValue>();
  let used = 0;
  for (const candidate of candidates) {
    if (blocks.has(candidate.id) || used + candidate.size > CONVERSATION_UI_BLOCKS_WIRE_BUDGET) continue;
    blocks.set(candidate.id, candidate.block);
    used += candidate.size;
  }
  const withBlock = (message: TeamProtocolV7BaseJsonValue): TeamProtocolV7BaseJsonValue => {
    if (!isDynamicRecord(message) || !isString(message.id)) return message;
    const uiBlock = blocks.get(message.id);
    return uiBlock === undefined ? message : { ...message, uiBlock };
  };
  const result: TeamProtocolV7BaseJsonObject = { ...projected };
  if (Array.isArray(result.messages)) result.messages = result.messages.map(withBlock);
  if (isDynamicRecord(result.references)) {
    result.references = Object.fromEntries(
      Object.entries(result.references).map(([id, value]) => [id, withBlock(value)]),
    );
  }
  return result;
}
