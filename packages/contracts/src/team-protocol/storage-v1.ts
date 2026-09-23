// Frozen optional storage-v1 wire contract. Keep IPC types and limits out of this file: every bound
// is written as a literal, so a change to `STORAGE_LIMITS` or `INPUT_LIMITS` cannot move a shipped
// wire contract.
//
// What this contract grants was a product decision and is recorded here because freezing it makes
// it permanent: every member of a server can read the host's storage - category sizes, per-agent and
// per-chat totals, and the names and sizes of the files sent in chats. An owner or admin can delete
// one of those files and clear the host's caches and logs; `requireAdmin` on those two routes is the
// only gate. Rows never carry a path, and workspace files and downloads travel only as category
// totals: the wire `source` is `attachment` or `generated`. Widening any of it needs a second
// capability string, never an edit to this one.
import { isDynamicRecord, isString } from "../runtime-values";
import type { TeamProtocolV2Json } from "./v2";

export const STORAGE_ROUTES = {
  usage: "/v1/storage/usage",
  deleteFile: "/v1/storage/delete-file",
  clear: "/v1/storage/clear",
} as const;

type Decoder = (value: unknown) => TeamProtocolV2Json;
type Fields = Record<string, Decoder>;

function text(value: unknown, maximum: number): string {
  if (!isString(value) || value.length > maximum) throw new Error("Invalid storage text.");
  return value;
}
function identifierText(value: unknown): string {
  if (!isString(value) || !value.length || value.length > 128) throw new Error("Invalid storage identifier.");
  return value;
}
function byteCount(value: unknown): number {
  // 2^53 - 1 bytes is 8 PiB, far past any disk, and it is the largest count JSON keeps exact.
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 0) throw new Error("Invalid storage size.");
  return value;
}
const string =
  (maximum: number): Decoder =>
  (value) =>
    text(value, maximum);
const identifier: Decoder = identifierText;
const count: Decoder = byteCount;
const boolean: Decoder = (value) => {
  if (typeof value !== "boolean") throw new Error("Invalid storage flag.");
  return value;
};
const oneOf =
  (...choices: string[]): Decoder =>
  (value) => {
    if (!isString(value) || !choices.includes(value)) throw new Error("Invalid storage value.");
    return value;
  };
const nullable =
  (decode: Decoder): Decoder =>
  (value) =>
    value === null ? null : decode(value);
const list =
  (decode: Decoder, maximum: number): Decoder =>
  (value) => {
    if (!Array.isArray(value) || value.length > maximum) throw new Error("Invalid storage list.");
    return value.map(decode);
  };
function record(value: unknown, fields: Fields): Record<string, TeamProtocolV2Json> {
  if (!isDynamicRecord(value)) throw new Error("Invalid storage record.");
  return Object.fromEntries(Object.entries(fields).map(([key, decode]) => [key, decode(value[key])]));
}
// A request drops an absent optional field instead of sending null, so the IPC parser on the far
// side sees the same shape the client built.
function sparseRecord(value: unknown, required: Fields, optionalFields: Fields): Record<string, TeamProtocolV2Json> {
  if (!isDynamicRecord(value)) throw new Error("Invalid storage record.");
  const decoded = record(value, required);
  for (const [key, decode] of Object.entries(optionalFields))
    if (value[key] !== undefined) decoded[key] = decode(value[key]);
  return decoded;
}

const categories = ["workspaces", "attachments", "generated", "chats", "downloads", "caches", "runtimes", "logs"];
const breakdown: Decoder = (value) =>
  record(value, { category: oneOf(...categories), bytes: count, removable: boolean });
const agent: Decoder = (value) =>
  record(value, { agentId: identifier, bytes: count, fileCount: count, conversationCount: count });
const conversation: Decoder = (value) =>
  record(value, {
    id: identifier,
    title: string(255),
    agentId: identifier,
    bytes: count,
    fileCount: count,
    messageCount: count,
  });
const fileConversation: Decoder = (value) => record(value, { id: identifier, title: string(255) });
const file: Decoder = (value) =>
  record(value, {
    id: identifier,
    name: string(255),
    size: count,
    kind: oneOf("image", "file"),
    mimeType: string(255),
    previewKind: oneOf("image", "pdf", "text", "none"),
    previewUrl: nullable(string(2_048)),
    source: oneOf("attachment", "generated"),
    agentId: nullable(identifier),
    conversation: nullable(fileConversation),
    messageId: nullable(identifier),
    createdAt: string(64),
    status: oneOf("available", "missing"),
    deletable: boolean,
  });
const usage: Decoder = (value) =>
  record(value, {
    scope: oneOf("host", "agent", "conversation"),
    agentId: nullable(identifier),
    conversationId: nullable(identifier),
    scannedAt: string(64),
    freeBytes: nullable(count),
    breakdown: list(breakdown, 8),
    agents: list(agent, 500),
    conversations: list(conversation, 200),
    files: list(file, 2_000),
    truncated: boolean,
  });
const usageRequest: Decoder = (value) =>
  sparseRecord(
    value,
    { scope: oneOf("host", "agent", "conversation") },
    { agentId: identifier, conversationId: identifier, force: boolean },
  );
// Delete and clear answer with nothing: the client measures again when it wants the new sizes.
const empty: Decoder = (value) => record(value, {});

const STORAGE_ROUTE_PATHS: ReadonlySet<string> = new Set(Object.values(STORAGE_ROUTES));

export function isStorageRoute(path: string): boolean {
  return STORAGE_ROUTE_PATHS.has(new URL(path, "http://openbot.invalid").pathname);
}

export function storageRequest(path: string, value: unknown): TeamProtocolV2Json {
  const pathname = new URL(path, "http://openbot.invalid").pathname;
  if (pathname === STORAGE_ROUTES.usage) return usageRequest(value);
  if (pathname === STORAGE_ROUTES.deleteFile) return record(value, { fileId: identifier });
  if (pathname === STORAGE_ROUTES.clear) return record(value, { category: oneOf("caches", "logs") });
  throw new Error("Unknown storage route.");
}

export function storageResponse(path: string, status: number, value: unknown): TeamProtocolV2Json {
  if (status >= 400) return record(value, { error: string(100_000) });
  const pathname = new URL(path, "http://openbot.invalid").pathname;
  if (pathname === STORAGE_ROUTES.usage) return usage(value);
  if (pathname === STORAGE_ROUTES.deleteFile || pathname === STORAGE_ROUTES.clear) return empty(value);
  throw new Error("Unknown storage route.");
}
