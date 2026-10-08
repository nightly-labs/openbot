import { isDynamicRecord, isString } from "../runtime-values";
import { normalizeConversationUiBlock } from "../ui-blocks";
import type { TeamProtocolV6BaseJsonObject, TeamProtocolV6BaseJsonValue } from "./v6-base";

/**
 * All the blocks of one snapshot, page or event together, as `JSON.stringify` writes them, in UTF-16
 * code units. One block is already bounded by the contract (`UI_BLOCK_LIMITS.specJson` and
 * `responseJson`), but a page carries up to a hundred messages and their references. The newest
 * blocks are kept up to this budget, and an older block over it is left out: its message still has
 * the fallback question or text that a client without `uiBlock` reads.
 */
const CONVERSATION_UI_BLOCKS_WIRE_BUDGET = 1_000_000;

/**
 * `uiBlock` rides beside the frozen conversation projection, in the way `plan` and `senderMember`
 * do: the shipped key lists drop it, so a client on protocol 1-5, or a v6 client that predates it,
 * reads the message as its fallback: a question prompt it can answer, or the block as text. Only the
 * current v6 adapter carries the block itself, so no protocol bump is needed.
 *
 * A present block must decode. The projection removes the key, so an unchecked value would reach
 * the client as a block the contract never allowed. Fail closed instead; an absent block still
 * means an older host, or an ordinary message. The block goes out normalized, with only known keys.
 */
export function withConversationUiBlocks(
  projected: TeamProtocolV6BaseJsonValue,
  source: unknown,
): TeamProtocolV6BaseJsonValue {
  if (!isDynamicRecord(projected) || !isDynamicRecord(source)) return projected;
  const fromMessages = Array.isArray(source.messages) ? source.messages : [];
  const fromReferences = isDynamicRecord(source.references) ? Object.values(source.references) : [];
  // Messages run oldest first, so the budget goes to the newest messages first. A page names the
  // messages its replies point at separately, and a quoted reply shows its block; those come last.
  const candidates: Array<{ id: string; block: TeamProtocolV6BaseJsonValue; size: number }> = [];
  for (const message of [...[...fromMessages].reverse(), ...fromReferences]) {
    if (!isDynamicRecord(message) || message.uiBlock === undefined) continue;
    const normalized = normalizeConversationUiBlock(message.uiBlock);
    if (!normalized) throw new Error("Invalid conversation ui block.");
    const json = JSON.stringify(normalized);
    if (isString(message.id)) candidates.push({ id: message.id, block: JSON.parse(json), size: json.length });
  }
  if (candidates.length === 0) return projected;
  const blocks = new Map<string, TeamProtocolV6BaseJsonValue>();
  let used = 0;
  for (const candidate of candidates) {
    if (blocks.has(candidate.id) || used + candidate.size > CONVERSATION_UI_BLOCKS_WIRE_BUDGET) continue;
    blocks.set(candidate.id, candidate.block);
    used += candidate.size;
  }
  const withBlock = (message: TeamProtocolV6BaseJsonValue): TeamProtocolV6BaseJsonValue => {
    if (!isDynamicRecord(message) || !isString(message.id)) return message;
    const uiBlock = blocks.get(message.id);
    return uiBlock === undefined ? message : { ...message, uiBlock };
  };
  const result: TeamProtocolV6BaseJsonObject = { ...projected };
  if (Array.isArray(result.messages)) result.messages = result.messages.map(withBlock);
  if (isDynamicRecord(result.references)) {
    result.references = Object.fromEntries(
      Object.entries(result.references).map(([id, value]) => [id, withBlock(value)]),
    );
  }
  return result;
}
