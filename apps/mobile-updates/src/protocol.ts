export const UPDATE_PLATFORMS = ["ios", "android"] as const;
export type UpdatePlatform = (typeof UPDATE_PLATFORMS)[number];

export const CHANNEL_PATTERN = /^[a-z][a-z0-9-]{0,31}$/u;
export const RUNTIME_VERSION_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._+-]{0,127}$/u;
export const ASSET_HASH_PATTERN = /^[A-Za-z0-9_-]{43}$/u;
export const UPDATE_ID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/u;
const SIGNATURE_PATTERN = /^[\x20-\x7e]{1,2048}$/u;

export const SIGNING_KEY_ID = "main";
export const SIGNING_ALGORITHM = "rsa-v1_5-sha256";

export function isUpdatePlatform(value: unknown): value is UpdatePlatform {
  return value === "ios" || value === "android";
}

export function assetKey(hash: string): string {
  return `assets/${hash}`;
}

export function updateKey(id: string): string {
  return `updates/${id}.json`;
}

export function pointerKey(channel: string, platform: UpdatePlatform, runtimeVersion: string): string {
  return `pointers/${channel}/${platform}/${runtimeVersion}.json`;
}

export interface StoredUpdate {
  version: 1;
  id: string;
  createdAt: string;
  platform: UpdatePlatform;
  runtimeVersion: string;
  channel: string;
  manifest: string;
  signature: string | null;
  commit: string;
  message: string;
  republishOf: string | null;
}

export interface StoredDirective {
  body: string;
  signature: string | null;
}

export type PointerTarget =
  | {
      kind: "update";
      id: string;
      rollout: number;
      baseId: string | null;
    }
  | { kind: "embedded"; directive: StoredDirective };

export interface PointerHistoryEntry {
  at: string;
  action: string;
  id: string | null;
}

export interface UpdatePointer {
  version: 1;
  updatedAt: string;
  target: PointerTarget;
  history: PointerHistoryEntry[];
}

interface JsonObject {
  readonly [key: string]: unknown;
}

function isRecord(value: unknown): value is JsonObject {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function parseObject(text: string): JsonObject | null {
  try {
    const value = JSON.parse(text);
    return isRecord(value) ? value : null;
  } catch {
    return null;
  }
}

function isSignature(value: unknown): value is string | null {
  return value === null || (typeof value === "string" && SIGNATURE_PATTERN.test(value));
}

function isUpdateId(value: unknown): value is string {
  return typeof value === "string" && UPDATE_ID_PATTERN.test(value);
}

export function decodeStoredUpdate(text: string): StoredUpdate | null {
  const value = parseObject(text);
  if (value?.version !== 1 || !isUpdateId(value.id)) return null;
  if (typeof value.createdAt !== "string" || Number.isNaN(Date.parse(value.createdAt))) return null;
  if (!isUpdatePlatform(value.platform)) return null;
  if (typeof value.runtimeVersion !== "string" || !RUNTIME_VERSION_PATTERN.test(value.runtimeVersion)) return null;
  if (typeof value.channel !== "string" || !CHANNEL_PATTERN.test(value.channel)) return null;
  if (typeof value.manifest !== "string" || value.manifest.length === 0 || !isSignature(value.signature)) return null;
  if (typeof value.commit !== "string" || typeof value.message !== "string") return null;
  if (value.republishOf !== null && !isUpdateId(value.republishOf)) return null;
  return {
    version: 1,
    id: value.id,
    createdAt: value.createdAt,
    platform: value.platform,
    runtimeVersion: value.runtimeVersion,
    channel: value.channel,
    manifest: value.manifest,
    signature: value.signature,
    commit: value.commit,
    message: value.message,
    republishOf: value.republishOf,
  };
}

function decodeTarget(value: unknown): PointerTarget | null {
  if (!isRecord(value)) return null;
  if (value.kind === "embedded") {
    const directive = value.directive;
    if (!isRecord(directive) || typeof directive.body !== "string" || directive.body.length === 0) return null;
    if (!isSignature(directive.signature)) return null;
    return { kind: "embedded", directive: { body: directive.body, signature: directive.signature } };
  }
  if (value.kind !== "update" || !isUpdateId(value.id)) return null;
  const rollout = value.rollout;
  if (typeof rollout !== "number" || !Number.isInteger(rollout) || rollout < 1 || rollout > 100) return null;
  if (value.baseId !== null && !isUpdateId(value.baseId)) return null;
  return { kind: "update", id: value.id, rollout, baseId: value.baseId };
}

function decodeHistory(value: unknown): PointerHistoryEntry[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((entry) => {
    if (!isRecord(entry) || typeof entry.at !== "string" || typeof entry.action !== "string") return [];
    return [{ at: entry.at, action: entry.action, id: isUpdateId(entry.id) ? entry.id : null }];
  });
}

export function decodeUpdatePointer(text: string): UpdatePointer | null {
  const value = parseObject(text);
  if (value?.version !== 1 || typeof value.updatedAt !== "string") return null;
  const target = decodeTarget(value.target);
  return target ? { version: 1, updatedAt: value.updatedAt, target, history: decodeHistory(value.history) } : null;
}

export async function rolloutBucket(clientId: string, updateId: string): Promise<number> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(`${updateId}:${clientId}`));
  return new DataView(digest).getUint32(0) % 100;
}
