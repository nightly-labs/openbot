// The objects that the publish script (`scripts/mobile-ota.ts`) writes to the bucket and that the
// Worker reads. This module has no Worker or Node types, so both sides can import it.
//
//   assets/<sha256, base64url>                       a bundle or an asset; the name is its hash
//   updates/<update id>.json                         a `StoredUpdate`: the signed manifest of one update
//   pointers/<channel>/<platform>/<runtime>.json     an `UpdatePointer`: what the phones of one binary get
//
// The publish script signs each manifest and each directive. The Worker holds no key: it sends the
// stored text and the stored signature as they are.

export const UPDATE_PLATFORMS = ["ios", "android"] as const;
export type UpdatePlatform = (typeof UPDATE_PLATFORMS)[number];

/** A build profile channel of `apps/mobile/eas.json`, such as `production`. */
export const CHANNEL_PATTERN = /^[a-z][a-z0-9-]{0,31}$/u;
/** The fingerprint of a binary, or a version string of an older runtime policy. */
export const RUNTIME_VERSION_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._+-]{0,127}$/u;
/** The SHA-256 of a file, base64url with no padding. */
export const ASSET_HASH_PATTERN = /^[A-Za-z0-9_-]{43}$/u;
export const UPDATE_ID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/u;
/** An `expo-signature` value. Printable ASCII only, so it cannot add a line to a part header. */
const SIGNATURE_PATTERN = /^[\x20-\x7e]{1,2048}$/u;

/** The key ID in `updates.codeSigningMetadata` of `apps/mobile/app.json`. */
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

/** One update. `manifest` is the exact text that `signature` signs, so no side may format it again. */
export interface StoredUpdate {
  version: 1;
  id: string;
  /** ISO 8601. A phone takes an update only when this is after the time of the update it runs. */
  createdAt: string;
  platform: UpdatePlatform;
  runtimeVersion: string;
  channel: string;
  manifest: string;
  /** The `expo-signature` value of `manifest`, or null for an update that no key signed. */
  signature: string | null;
  /** The commit of the bundle. */
  commit: string;
  message: string;
  /** The update that this one publishes again, for a rollback to an earlier update. */
  republishOf: string | null;
}

/** A signed instruction with no bundle, such as "use the bundle in the binary". */
export interface StoredDirective {
  body: string;
  signature: string | null;
}

export type PointerTarget =
  | {
      kind: "update";
      id: string;
      /** The percentage of phones, 1 to 100, that get `id`. */
      rollout: number;
      /** The update of the other phones, or null when they keep the bundle that they have. */
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
  /** The earlier targets, newest first. The publish script reads it; the Worker does not. */
  history: PointerHistoryEntry[];
}

interface JsonObject {
  readonly [key: string]: unknown;
}

function isRecord(value: unknown): value is JsonObject {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** The object of a JSON text. Null for a text that is not JSON or not an object, such as `null`. */
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

/** The update in the JSON text of an `updates/` object. Null when the text is not a valid update. */
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

/** The pointer in the JSON text of a `pointers/` object. Null when the text is not a valid pointer. */
export function decodeUpdatePointer(text: string): UpdatePointer | null {
  const value = parseObject(text);
  if (value?.version !== 1 || typeof value.updatedAt !== "string") return null;
  const target = decodeTarget(value.target);
  return target ? { version: 1, updatedAt: value.updatedAt, target, history: decodeHistory(value.history) } : null;
}

/**
 * The place of one install in the rollout of one update, 0 to 99. It uses the update ID, so each
 * update takes a different part of the phones, and a phone keeps its place while the percentage grows.
 */
export async function rolloutBucket(clientId: string, updateId: string): Promise<number> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(`${updateId}:${clientId}`));
  return new DataView(digest).getUint32(0) % 100;
}
