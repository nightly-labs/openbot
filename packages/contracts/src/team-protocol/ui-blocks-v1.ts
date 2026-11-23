import { isDynamicRecord, isString } from "../runtime-values";
import { normalizeConversationUiBlock, type UiBlockState } from "../ui-blocks";
import type { TeamProtocolV7BaseJsonObject, TeamProtocolV7BaseJsonValue } from "./v7-base";

export const TEAM_UI_BLOCKS_CAPABILITY = "ui-blocks-v1";

const CONVERSATION_UI_BLOCKS_WIRE_BUDGET = 1_000_000;

function v1State({ autoAnswer: _autoAnswer, ...state }: UiBlockState): UiBlockState {
  return state;
}

export function withConversationUiBlocks(
  projected: TeamProtocolV7BaseJsonValue,
  source: unknown,
): TeamProtocolV7BaseJsonValue {
  if (!isDynamicRecord(projected) || !isDynamicRecord(source)) return projected;
  const fromMessages = Array.isArray(source.messages) ? source.messages : [];
  const fromReferences = isDynamicRecord(source.references) ? Object.values(source.references) : [];
  const candidates: Array<{ id: string; block: TeamProtocolV7BaseJsonValue; size: number }> = [];
  for (const message of [...[...fromMessages].reverse(), ...fromReferences]) {
    if (!isDynamicRecord(message) || message.uiBlock === undefined) continue;
    const normalized = normalizeConversationUiBlock(message.uiBlock);
    if (!normalized) throw new Error("Invalid conversation UI block.");
    const { vault: _vault, apiKey: _apiKey, ...v1Block } = normalized;
    const json = JSON.stringify({ ...v1Block, state: v1State(v1Block.state) });
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
