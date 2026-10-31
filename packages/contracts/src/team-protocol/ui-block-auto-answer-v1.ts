import { isDynamicRecord, isString } from "../runtime-values";
import { normalizeConversationUiBlock, type UiBlockAutoAnswer } from "../ui-blocks";
import { decodeTeamProtocolV2Json } from "./v2";

/**
 * Frozen optional ui-block-auto-answer-v1 contract. It adds one key to the blocks that `ui-blocks-v1`
 * already sends: `state.autoAnswer` ({ actionId, at, done? }), the action that the host presses at
 * `at` when nobody answers, such as the start button of the plan card before a long task. With it, a
 * client counts down to `at`, and after the host answered, says that nobody answered in time. The
 * host adds the key only for a client that advertises this capability, and only to a message whose
 * block `ui-blocks-v1` already sends: the key is copied from the stored block with the same message
 * id and block id. The `ui-blocks-v1` codecs leave it out in both directions, so a client copies it back from the
 * wire value after it decodes. A protocol 9 capability only. Widening any of it needs a second
 * capability string.
 */
export const TEAM_UI_BLOCK_AUTO_ANSWER_CAPABILITY = "ui-block-auto-answer-v1";

/** Deeper than any conversation snapshot, page or event of the Team API. */
const MAXIMUM_DEPTH = 12;

/** A message and its block: a task conversation and the main one can hold the same message id. */
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
    // A block that the contract refuses carries no automatic answer.
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

/**
 * Sets `state.autoAnswer` on each block in `target` from the block of the message with the same id in
 * `source`. `target` is a value that its caller owns, such as a fresh encoder or decoder result: it
 * changes in place. A block that `target` does not send stays out.
 */
export function addUiBlockAutoAnswers(target: object, source: unknown): void {
  const autoAnswers = new Map<string, UiBlockAutoAnswer>();
  collect(source, autoAnswers, 0);
  if (autoAnswers.size > 0) apply(target, autoAnswers, 0);
}

/**
 * `encoded`, a Team API body or event as JSON text, with the automatic answers of `source`, the value
 * before the protocol adapter projected it. Text without a block to change comes back unchanged.
 */
export function withUiBlockAutoAnswers(encoded: string, source: unknown): string {
  const autoAnswers = new Map<string, UiBlockAutoAnswer>();
  collect(source, autoAnswers, 0);
  if (autoAnswers.size === 0) return encoded;
  const value = decodeTeamProtocolV2Json(JSON.parse(encoded));
  apply(value, autoAnswers, 0);
  return JSON.stringify(value);
}
