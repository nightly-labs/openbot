import { isDynamicRecord, isString } from "../runtime-values";
import { normalizeConversationUiBlock, type UiBlockVaultRequest } from "../ui-blocks";
import { decodeTeamProtocolV2Json } from "./webrtc-framing";

export const TEAM_UI_BLOCK_VAULT_CAPABILITY = "ui-block-vault-v1";

const MAXIMUM_DEPTH = 12;

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

export function addUiBlockVaultRequests(target: unknown, source: unknown): void {
  const requests = new Map<string, UiBlockVaultRequest>();
  collect(source, requests, 0);
  if (requests.size > 0) apply(target, requests, 0);
}

export function withUiBlockVaultRequests(encoded: string, source: unknown): string {
  const requests = new Map<string, UiBlockVaultRequest>();
  collect(source, requests, 0);
  if (requests.size === 0) return encoded;
  const value = decodeTeamProtocolV2Json(JSON.parse(encoded));
  apply(value, requests, 0);
  return JSON.stringify(value);
}
