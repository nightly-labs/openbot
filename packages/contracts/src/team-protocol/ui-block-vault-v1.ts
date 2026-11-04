import { isDynamicRecord, isString } from "../runtime-values";
import { normalizeConversationUiBlock, type UiBlockVaultRequest } from "../ui-blocks";
import { decodeTeamProtocolV2Json } from "./v2";

/**
 * Frozen optional ui-block-vault-v1 contract. It adds one key to the blocks that `ui-blocks-v1`
 * already sends: `vault` ({ kind, saved? }, see `UiBlockVaultRequest`), which marks the form of
 * `request_vault_item`. With it, a client shows a Vault card in place of the form, and after the user
 * saved the item, its name and the last four digits of a card. The key never holds a secret value. The
 * client still answers through the released prompt route, with the form's field ids. The host adds
 * the key only for a client that advertises this capability, and only to a message whose block
 * `ui-blocks-v1` already sends: the key is copied from the stored block with the same message id and
 * block id. The `ui-blocks-v1` codecs leave it out in both directions, so a client copies it back from
 * the wire value after it decodes. A protocol 9 capability only. Widening any of it needs a second
 * capability string.
 */
export const TEAM_UI_BLOCK_VAULT_CAPABILITY = "ui-block-vault-v1";

/** Deeper than any conversation snapshot, page or event of the Team API. */
const MAXIMUM_DEPTH = 12;

/** A message and its block: a task conversation and the main one can hold the same message id. */
function blockKey(messageId: string, blockId: string): string {
  return `${messageId}\n${blockId}`;
}

function collect(value: unknown, into: Map<string, UiBlockVaultRequest>, depth: number): void {
  if (depth > MAXIMUM_DEPTH) return;
  if (Array.isArray(value)) {
    for (const item of value) collect(item, into, depth + 1);
    return;
  }
  if (!isDynamicRecord(value)) return;
  if (isString(value.id) && value.uiBlock !== undefined) {
    // A block that the contract refuses carries no Vault request.
    const block = normalizeConversationUiBlock(value.uiBlock);
    if (block?.vault) into.set(blockKey(value.id, block.blockId), block.vault);
  }
  for (const child of Object.values(value)) collect(child, into, depth + 1);
}

function apply(value: unknown, requests: ReadonlyMap<string, UiBlockVaultRequest>, depth: number): void {
  if (depth > MAXIMUM_DEPTH) return;
  if (Array.isArray(value)) {
    for (const item of value) apply(item, requests, depth + 1);
    return;
  }
  if (!isDynamicRecord(value)) return;
  const block = value.uiBlock;
  const request =
    isString(value.id) && isDynamicRecord(block) && isString(block.blockId)
      ? requests.get(blockKey(value.id, block.blockId))
      : undefined;
  if (request && isDynamicRecord(block))
    Object.assign(block, { vault: request.saved ? { ...request, saved: { ...request.saved } } : { ...request } });
  for (const child of Object.values(value)) apply(child, requests, depth + 1);
}

/**
 * Sets `vault` on each block in `target` from the block of the message with the same id in `source`.
 * `target` is a value that its caller owns, such as a fresh encoder or decoder result: it changes in
 * place. A block that `target` does not send stays out.
 */
export function addUiBlockVaultRequests(target: unknown, source: unknown): void {
  const requests = new Map<string, UiBlockVaultRequest>();
  collect(source, requests, 0);
  if (requests.size > 0) apply(target, requests, 0);
}

/**
 * `encoded`, a Team API body or event as JSON text, with the Vault requests of `source`, the value
 * before the protocol adapter projected it. Text without a block to change comes back unchanged.
 */
export function withUiBlockVaultRequests(encoded: string, source: unknown): string {
  const requests = new Map<string, UiBlockVaultRequest>();
  collect(source, requests, 0);
  if (requests.size === 0) return encoded;
  const value = decodeTeamProtocolV2Json(JSON.parse(encoded));
  apply(value, requests, 0);
  return JSON.stringify(value);
}
