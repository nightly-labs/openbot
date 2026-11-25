import { isDynamicRecord, isString } from "../runtime-values";
import { normalizeConversationUiBlock, type UiBlockAutoAnswer } from "../ui-blocks";
import { decodeTeamProtocolV2Json } from "./webrtc-framing";

export const TEAM_UI_BLOCK_AUTO_ANSWER_CAPABILITY = "ui-block-auto-answer-v1";

const MAXIMUM_DEPTH = 12;

function blockKey(messageId: string, blockId: string): string {
  return `${messageId}\n${blockId}`;
}

function collect(value: unknown, into: Map<string, UiBlockAutoAnswer>, depth: number): void {
  if (depth > MAXIMUM_DEPTH) return;
  if (Array.isArray(value)) {
    for (const item of value) collect(item, into, depth + 1);
    return;
  }
  if (!isDynamicRecord(value)) return;
  if (isString(value.id) && value.uiBlock !== undefined) {
    const block = normalizeConversationUiBlock(value.uiBlock);
    if (block?.state.autoAnswer) into.set(blockKey(value.id, block.blockId), block.state.autoAnswer);
  }
  for (const child of Object.values(value)) collect(child, into, depth + 1);
}

function apply(value: unknown, autoAnswers: ReadonlyMap<string, UiBlockAutoAnswer>, depth: number): void {
  if (depth > MAXIMUM_DEPTH) return;
  if (Array.isArray(value)) {
    for (const item of value) apply(item, autoAnswers, depth + 1);
    return;
  }
  if (!isDynamicRecord(value)) return;
  const block = value.uiBlock;
  const autoAnswer =
    isString(value.id) && isDynamicRecord(block) && isString(block.blockId)
      ? autoAnswers.get(blockKey(value.id, block.blockId))
      : undefined;
  if (autoAnswer && isDynamicRecord(block) && isDynamicRecord(block.state))
    Object.assign(block.state, { autoAnswer: { ...autoAnswer } });
  for (const child of Object.values(value)) apply(child, autoAnswers, depth + 1);
}

export function addUiBlockAutoAnswers(target: unknown, source: unknown): void {
  const autoAnswers = new Map<string, UiBlockAutoAnswer>();
  collect(source, autoAnswers, 0);
  if (autoAnswers.size > 0) apply(target, autoAnswers, 0);
}

export function withUiBlockAutoAnswers(encoded: string, source: unknown): string {
  const autoAnswers = new Map<string, UiBlockAutoAnswer>();
  collect(source, autoAnswers, 0);
  if (autoAnswers.size === 0) return encoded;
  const value = decodeTeamProtocolV2Json(JSON.parse(encoded));
  apply(value, autoAnswers, 0);
  return JSON.stringify(value);
}
