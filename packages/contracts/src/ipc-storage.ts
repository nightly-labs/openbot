/**
 * Storage and files: how much disk space a host uses, where it goes, and the files it keeps. The
 * Server settings Storage tab, the agent Files detail and the chat Files panel all read one
 * `StorageUsage`, cut to their scope.
 *
 * A file row is an `AttachmentSummary` with its place and state added, so an attachment converts to
 * a row without a second shape. Rows never carry a path: the host resolves a file from its id.
 */

import { type AttachmentSummary, isAttachmentSummary } from "./ipc-attachments";
import { isBoundedString, isIdentifier, isNullableBoundedString } from "./ipc-bounded-values";
import { isBoolean, isDynamicRecord, isNumber, isOneOf, isString } from "./runtime-values";

/**
 * Additive, optional Team API behaviour: a host that does not advertise this string has no storage
 * routes, and the Storage tab says so. The string is permanent - evolving it means a second
 * capability, never an edit.
 */
export const STORAGE_CAPABILITY = "storage-v1";

export const STORAGE_CATEGORIES = [
  "workspaces",
  "attachments",
  "generated",
  "chats",
  "downloads",
  "caches",
  "runtimes",
  "logs",
] as const;

/** One row per storage location the host can measure. */
export type StorageCategory = (typeof STORAGE_CATEGORIES)[number];

/** The categories the user can clear without losing a chat, a file they sent, or agent work. */
export const CLEARABLE_STORAGE_CATEGORIES = ["caches", "logs"] as const;
export type ClearableStorageCategory = (typeof CLEARABLE_STORAGE_CATEGORIES)[number];

export const STORED_FILE_SOURCES = ["attachment", "generated", "workspace", "download"] as const;
/** Where the file came from. Each value maps to one storage location on the host. */
export type StoredFileSource = (typeof STORED_FILE_SOURCES)[number];

export const STORED_FILE_STATUSES = ["available", "missing", "remote", "failed"] as const;
/**
 * `missing`: the record exists but the file is gone from the disk.
 * `remote`: the file is on the server and not yet on this computer.
 * `failed`: the upload or download did not complete.
 */
export type StoredFileStatus = (typeof STORED_FILE_STATUSES)[number];

export const STORAGE_SCOPES = ["host", "agent", "conversation"] as const;
export type StorageScope = (typeof STORAGE_SCOPES)[number];

/** A host with more rows than this sends the largest ones and sets `truncated`. */
export const STORAGE_LIMITS = {
  files: 2_000,
  conversations: 200,
  agents: 500,
  title: 255,
} as const;

export interface StorageBreakdown {
  category: StorageCategory;
  bytes: number;
  /** The user can clear it without losing a chat, a file they sent, or agent work. */
  removable: boolean;
}

export interface AgentStorageRow {
  agentId: string;
  bytes: number;
  fileCount: number;
  conversationCount: number;
}

export interface ConversationStorageRow {
  id: string;
  title: string;
  agentId: string;
  bytes: number;
  fileCount: number;
  messageCount: number;
}

export interface StoredFileConversation {
  id: string;
  title: string;
}

export interface StoredFileRow extends AttachmentSummary {
  source: StoredFileSource;
  agentId: string | null;
  conversation: StoredFileConversation | null;
  /** The chat message that carries the file. Null when the file is in no message the host can name. */
  messageId: string | null;
  /** ISO time the file was added. */
  createdAt: string;
  status: StoredFileStatus;
  /** The host can delete this file. False for workspace files and downloads, which the agent owns. */
  deletable: boolean;
}

export interface StorageUsage {
  scope: StorageScope;
  agentId: string | null;
  conversationId: string | null;
  scannedAt: string;
  /** Free space on the disk that holds the host data. Null when the host cannot tell. */
  freeBytes: number | null;
  breakdown: StorageBreakdown[];
  agents: AgentStorageRow[];
  conversations: ConversationStorageRow[];
  files: StoredFileRow[];
  /** A list was cut at `STORAGE_LIMITS`. The breakdown still counts every byte. */
  truncated: boolean;
}

export interface GetStorageUsageInput {
  scope: StorageScope;
  agentId?: string;
  conversationId?: string;
  /** Measure again, even when a recent result is cached. */
  force?: boolean;
}

export interface DeleteStoredFileInput {
  fileId: string;
}

export interface ClearStorageInput {
  category: ClearableStorageCategory;
}

export interface OpenStoredFileInput {
  fileId: string;
  action: "open" | "reveal" | "download";
}

export interface OpenStorageLocationInput {
  agentId: string;
}

function invalid(label: string): never {
  throw new Error(`Invalid ${label}.`);
}

function record(value: unknown, label: string) {
  if (!isDynamicRecord(value)) invalid(label);
  return value;
}

function identifier(value: unknown, label: string): string {
  if (!isIdentifier(value)) invalid(label);
  return value;
}

function optionalIdentifier(value: unknown, label: string): string | undefined {
  return value === undefined ? undefined : identifier(value, label);
}

function byteCount(value: unknown, label: string): number {
  if (!isNumber(value) || !Number.isSafeInteger(value) || value < 0) invalid(label);
  return value;
}

function list<T>(value: unknown, maximum: number, decode: (item: unknown) => T, label: string): T[] {
  if (!Array.isArray(value) || value.length > maximum) invalid(label);
  return value.map(decode);
}

export function parseGetStorageUsageInput(value: unknown): GetStorageUsageInput {
  const input = record(value, "storage request");
  if (!isOneOf(STORAGE_SCOPES, input.scope)) invalid("storage scope");
  if (input.force !== undefined && !isBoolean(input.force)) invalid("storage refresh flag");
  const agentId = optionalIdentifier(input.agentId, "storage agent");
  const conversationId = optionalIdentifier(input.conversationId, "storage conversation");
  if (input.scope === "agent" && !agentId) invalid("storage agent");
  if (input.scope === "conversation" && !conversationId) invalid("storage conversation");
  return {
    scope: input.scope,
    ...(agentId === undefined ? {} : { agentId }),
    ...(conversationId === undefined ? {} : { conversationId }),
    ...(input.force === undefined ? {} : { force: input.force }),
  };
}

export function parseDeleteStoredFileInput(value: unknown): DeleteStoredFileInput {
  return { fileId: identifier(record(value, "file request").fileId, "file") };
}

export function parseClearStorageInput(value: unknown): ClearStorageInput {
  const input = record(value, "clear request");
  if (!isOneOf(CLEARABLE_STORAGE_CATEGORIES, input.category)) invalid("storage category");
  return { category: input.category };
}

export function parseOpenStoredFileInput(value: unknown): OpenStoredFileInput {
  const input = record(value, "file request");
  if (!isOneOf(["open", "reveal", "download"] as const, input.action)) invalid("file action");
  return { fileId: identifier(input.fileId, "file"), action: input.action };
}

export function parseOpenStorageLocationInput(value: unknown): OpenStorageLocationInput {
  return { agentId: identifier(record(value, "location request").agentId, "agent") };
}

function decodeBreakdown(value: unknown): StorageBreakdown {
  const entry = record(value, "storage category");
  if (!isOneOf(STORAGE_CATEGORIES, entry.category)) invalid("storage category");
  if (!isBoolean(entry.removable)) invalid("storage category");
  return { category: entry.category, bytes: byteCount(entry.bytes, "storage size"), removable: entry.removable };
}

function decodeAgentRow(value: unknown): AgentStorageRow {
  const row = record(value, "agent storage");
  return {
    agentId: identifier(row.agentId, "agent storage"),
    bytes: byteCount(row.bytes, "agent storage"),
    fileCount: byteCount(row.fileCount, "agent storage"),
    conversationCount: byteCount(row.conversationCount, "agent storage"),
  };
}

function title(value: unknown, label: string): string {
  if (!isBoundedString(value, STORAGE_LIMITS.title)) invalid(label);
  return value;
}

function decodeConversationRow(value: unknown): ConversationStorageRow {
  const row = record(value, "chat storage");
  return {
    id: identifier(row.id, "chat storage"),
    title: title(row.title, "chat storage"),
    agentId: identifier(row.agentId, "chat storage"),
    bytes: byteCount(row.bytes, "chat storage"),
    fileCount: byteCount(row.fileCount, "chat storage"),
    messageCount: byteCount(row.messageCount, "chat storage"),
  };
}

function decodeFileRow(value: unknown): StoredFileRow {
  const row = record(value, "stored file");
  if (!isAttachmentSummary(row)) invalid("stored file");
  if (!isOneOf(STORED_FILE_SOURCES, row.source)) invalid("stored file source");
  if (!isOneOf(STORED_FILE_STATUSES, row.status)) invalid("stored file status");
  if (!isBoolean(row.deletable) || !isString(row.createdAt)) invalid("stored file");
  if (row.agentId !== null && !isIdentifier(row.agentId)) invalid("stored file agent");
  if (row.messageId !== null && !isIdentifier(row.messageId)) invalid("stored file message");
  let conversation: StoredFileConversation | null = null;
  if (row.conversation !== null) {
    const entry = record(row.conversation, "stored file chat");
    conversation = { id: identifier(entry.id, "stored file chat"), title: title(entry.title, "stored file chat") };
  }
  return {
    id: row.id,
    name: row.name,
    size: row.size,
    kind: row.kind,
    mimeType: row.mimeType,
    previewKind: row.previewKind,
    previewUrl: row.previewUrl,
    source: row.source,
    agentId: row.agentId,
    conversation,
    messageId: row.messageId,
    createdAt: row.createdAt,
    status: row.status,
    deletable: row.deletable,
  };
}

export function decodeStorageUsage(value: unknown): StorageUsage {
  const usage = record(value, "storage usage");
  if (!isOneOf(STORAGE_SCOPES, usage.scope)) invalid("storage scope");
  if (!isNullableBoundedString(usage.agentId, 128) || !isNullableBoundedString(usage.conversationId, 128))
    invalid("storage scope");
  if (!isString(usage.scannedAt) || !isBoolean(usage.truncated)) invalid("storage usage");
  return {
    scope: usage.scope,
    agentId: usage.agentId,
    conversationId: usage.conversationId,
    scannedAt: usage.scannedAt,
    freeBytes: usage.freeBytes === null ? null : byteCount(usage.freeBytes, "free space"),
    breakdown: list(usage.breakdown, STORAGE_CATEGORIES.length, decodeBreakdown, "storage breakdown"),
    agents: list(usage.agents, STORAGE_LIMITS.agents, decodeAgentRow, "agent storage"),
    conversations: list(usage.conversations, STORAGE_LIMITS.conversations, decodeConversationRow, "chat storage"),
    files: list(usage.files, STORAGE_LIMITS.files, decodeFileRow, "stored files"),
    truncated: usage.truncated,
  };
}

/** A remote host without `storage-v1` answers null, and the surface says the host needs an update. */
export function decodeOptionalStorageUsage(value: unknown): StorageUsage | null {
  return value === null ? null : decodeStorageUsage(value);
}

/** A host must answer the scope it was asked for, or a panel shows another agent's files. */
export function assertStorageUsageScope(result: StorageUsage, input: GetStorageUsageInput): StorageUsage {
  if (
    result.scope !== input.scope ||
    result.agentId !== (input.agentId ?? null) ||
    result.conversationId !== (input.conversationId ?? null)
  )
    throw new Error("Storage response does not match the request.");
  return result;
}
