import { isDynamicRecord, isNumber, isString } from "../runtime-values";
import { normalizeConversationUiBlock } from "../ui-blocks";
import { decodeTeamProtocolV2Json } from "./webrtc-framing";

export const TEAM_UI_BLOCK_LOCATION_CAPABILITY = "ui-block-location-v1";

export type SharedLocation = {
  latitude: number;
  longitude: number;
  accuracyMeters: number | null;
  capturedAt: string;
};

export const SHARED_LOCATION_ACCURACY_LIMIT = 100_000;

const MAXIMUM_DEPTH = 12;
const CAPTURED_AT_LIMIT = 64;

function isBoundedNumber(value: unknown, min: number, max: number): value is number {
  return isNumber(value) && Number.isFinite(value) && value >= min && value <= max;
}

export function encodeSharedLocationAnswer(location: SharedLocation): string {
  return JSON.stringify({
    latitude: location.latitude,
    longitude: location.longitude,
    accuracyMeters: location.accuracyMeters,
    capturedAt: location.capturedAt,
  });
}

export function decodeSharedLocationAnswer(text: string): SharedLocation | null {
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch {
    return null;
  }
  if (
    !isDynamicRecord(value) ||
    !isBoundedNumber(value.latitude, -90, 90) ||
    !isBoundedNumber(value.longitude, -180, 180) ||
    !(value.accuracyMeters === null || isBoundedNumber(value.accuracyMeters, 0, SHARED_LOCATION_ACCURACY_LIMIT)) ||
    !isString(value.capturedAt) ||
    value.capturedAt.length > CAPTURED_AT_LIMIT ||
    Number.isNaN(Date.parse(value.capturedAt))
  )
    return null;
  return {
    latitude: value.latitude,
    longitude: value.longitude,
    accuracyMeters: value.accuracyMeters,
    capturedAt: value.capturedAt,
  };
}

function blockKey(messageId: string, blockId: string): string {
  return `${messageId}\n${blockId}`;
}

function collect(value: unknown, into: Set<string>, depth: number): void {
  if (depth > MAXIMUM_DEPTH) return;
  if (Array.isArray(value)) {
    for (const item of value) collect(item, into, depth + 1);
    return;
  }
  if (!isDynamicRecord(value)) return;
  if (isString(value.id) && value.uiBlock !== undefined) {
    const block = normalizeConversationUiBlock(value.uiBlock);
    if (block?.location) into.add(blockKey(value.id, block.blockId));
  }
  for (const child of Object.values(value)) collect(child, into, depth + 1);
}

function apply(value: unknown, requests: ReadonlySet<string>, depth: number): void {
  if (depth > MAXIMUM_DEPTH) return;
  if (Array.isArray(value)) {
    for (const item of value) apply(item, requests, depth + 1);
    return;
  }
  if (!isDynamicRecord(value)) return;
  const block = value.uiBlock;
  if (
    isString(value.id) &&
    isDynamicRecord(block) &&
    isString(block.blockId) &&
    requests.has(blockKey(value.id, block.blockId))
  )
    Object.assign(block, { location: true });
  for (const child of Object.values(value)) apply(child, requests, depth + 1);
}

export function addUiBlockLocationRequests(target: unknown, source: unknown): void {
  const requests = new Set<string>();
  collect(source, requests, 0);
  if (requests.size > 0) apply(target, requests, 0);
}

export function withUiBlockLocationRequests(encoded: string, source: unknown): string {
  const requests = new Set<string>();
  collect(source, requests, 0);
  if (requests.size === 0) return encoded;
  const value = decodeTeamProtocolV2Json(JSON.parse(encoded));
  apply(value, requests, 0);
  return JSON.stringify(value);
}
