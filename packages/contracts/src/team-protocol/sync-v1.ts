import { isBoolean, isDynamicRecord, isString } from "../runtime-values";

export const SYNC_CAPABILITY = "sync-v1";

export const SYNC_LIMITS = {
  base: 64,
  param: 128,
  name: 193,
  key: 128,
  version: 32,
  cursor: 1_024,
  order: 128,
  requestId: 64,
  entriesPerMessage: 2_000,
  entriesPerChunk: 1_000,
  chunkBytes: 192 * 1_024,
  rowBytes: 1_024 * 1_024,
  haveEntries: 50_000,
  logRows: 200,
} as const;

export type SyncKeyVersion = readonly [key: string, version: string];

export interface SyncUpsert {
  key: string;
  version: string;
  value: unknown;
}

export interface SyncLogRow {
  key: string;
  order: string;
  value: unknown;
}

export interface SyncLogReference {
  key: string;
  value: unknown;
}

export type SyncClientMessage =
  | { type: "sync-subscribe"; collection: string; have: SyncKeyVersion[]; more: boolean }
  | { type: "sync-unsubscribe"; collection: string }
  | { type: "sync-barrier"; id: string }
  | { type: "sync-log-subscribe"; log: string; after: string | null; limit: number }
  | { type: "sync-log-older"; log: string; id: string; before: string; limit: number };

export type SyncServerMessage =
  | { type: "sync-changes"; collection: string; upserts: SyncUpsert[]; deletes: string[]; synced: boolean }
  | { type: "sync-barrier"; id: string }
  | { type: "sync-unavailable"; collection: string }
  | {
      type: "sync-log-changes";
      log: string;
      rows: SyncLogRow[];
      deletes: string[];
      cursor: string;
      reset: boolean;
      olderCursor: string | null;
      synced: boolean;
      references?: SyncLogReference[];
    }
  | {
      type: "sync-log-page";
      log: string;
      id: string;
      rows: SyncLogRow[];
      olderCursor: string | null;
      done: boolean;
      references?: SyncLogReference[];
    };

export interface SyncName {
  readonly base: string;
  readonly param: string | null;
}

const BASE_NAME = /^[a-z0-9][a-z0-9-]*(\.[a-z0-9-]+)*$/u;
const PARAM = /^[A-Za-z0-9_-]+$/u;
const REQUEST_ID = /^[A-Za-z0-9_-]+$/u;

export function parseSyncName(value: unknown): SyncName | null {
  if (!isString(value) || value.length > SYNC_LIMITS.name) return null;
  const separator = value.indexOf(":");
  const base = separator < 0 ? value : value.slice(0, separator);
  const param = separator < 0 ? null : value.slice(separator + 1);
  if (base.length > SYNC_LIMITS.base || !BASE_NAME.test(base)) return null;
  if (param !== null && (param.length === 0 || param.length > SYNC_LIMITS.param || !PARAM.test(param))) return null;
  return { base, param };
}

export function syncName(base: string, param?: string | null): string {
  const name = param == null ? base : `${base}:${param}`;
  if (!parseSyncName(name)) throw new Error("Invalid sync name.");
  return name;
}

export function isSyncName(value: unknown): value is string {
  return parseSyncName(value) !== null;
}

export function isSyncKey(value: unknown): value is string {
  return isString(value) && value.length > 0 && value.length <= SYNC_LIMITS.key;
}

export function isSyncVersion(value: unknown): value is string {
  return isString(value) && value.length > 0 && value.length <= SYNC_LIMITS.version;
}

function isCursor(value: unknown): value is string {
  return isString(value) && value.length > 0 && value.length <= SYNC_LIMITS.cursor;
}

function isOrder(value: unknown): value is string {
  return isString(value) && value.length > 0 && value.length <= SYNC_LIMITS.order;
}

function isRequestId(value: unknown): value is string {
  return isString(value) && value.length <= SYNC_LIMITS.requestId && REQUEST_ID.test(value);
}

function isLogLimit(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value) && value >= 1 && value <= SYNC_LIMITS.logRows;
}

function isKeyVersion(value: unknown): value is SyncKeyVersion {
  return Array.isArray(value) && value.length === 2 && isSyncKey(value[0]) && isSyncVersion(value[1]);
}

function boundedList(value: unknown): value is unknown[] {
  return Array.isArray(value) && value.length <= SYNC_LIMITS.entriesPerMessage;
}

function invalidSyncMessage(): Error {
  return new Error("Invalid sync message.");
}

function required<T>(value: unknown, check: (value: unknown) => value is T): T {
  if (!check(value)) throw invalidSyncMessage();
  return value;
}

function nullable<T>(value: unknown, check: (value: unknown) => value is T): T | null {
  return value === null ? null : required(value, check);
}

const CLIENT_TYPES = new Set<string>([
  "sync-subscribe",
  "sync-unsubscribe",
  "sync-barrier",
  "sync-log-subscribe",
  "sync-log-older",
]);

export function decodeSyncClientMessage(value: unknown): SyncClientMessage | null {
  if (!isDynamicRecord(value)) return null;
  switch (value.type) {
    case "sync-subscribe": {
      const have = required(value.have, boundedList);
      if (!have.every(isKeyVersion)) throw invalidSyncMessage();
      return {
        type: "sync-subscribe",
        collection: required(value.collection, isSyncName),
        have: have.map(([key, version]) => [key, version] as const),
        more: required(value.more ?? false, isBoolean),
      };
    }
    case "sync-unsubscribe":
      return { type: "sync-unsubscribe", collection: required(value.collection, isSyncName) };
    case "sync-barrier":
      return { type: "sync-barrier", id: required(value.id, isRequestId) };
    case "sync-log-subscribe":
      return {
        type: "sync-log-subscribe",
        log: required(value.log, isSyncName),
        after: nullable(value.after ?? null, isCursor),
        limit: required(value.limit, isLogLimit),
      };
    case "sync-log-older":
      return {
        type: "sync-log-older",
        log: required(value.log, isSyncName),
        id: required(value.id, isRequestId),
        before: required(value.before, isCursor),
        limit: required(value.limit, isLogLimit),
      };
    default:
      return null;
  }
}

export function isSyncClientMessage<Other extends { type: string }>(
  value: Other | SyncClientMessage,
): value is SyncClientMessage {
  return CLIENT_TYPES.has(value.type);
}

function isUpsert(value: unknown): value is SyncUpsert {
  return (
    isDynamicRecord(value) && isSyncKey(value.key) && isSyncVersion(value.version) && Object.hasOwn(value, "value")
  );
}

function isLogRow(value: unknown): value is SyncLogRow {
  return isDynamicRecord(value) && isSyncKey(value.key) && isOrder(value.order) && Object.hasOwn(value, "value");
}

function keyList(value: unknown): string[] {
  const list = required(value, boundedList);
  if (!list.every(isSyncKey)) throw invalidSyncMessage();
  return [...list];
}

function logRows(value: unknown): SyncLogRow[] {
  const list = required(value, boundedList);
  if (!list.every(isLogRow)) throw invalidSyncMessage();
  return list.map(({ key, order, value: entity }) => ({ key, order, value: entity }));
}

function isLogReference(value: unknown): value is SyncLogReference {
  return isDynamicRecord(value) && isSyncKey(value.key) && Object.hasOwn(value, "value");
}

function logReferences(value: unknown): { references?: SyncLogReference[] } {
  if (value === undefined) return {};
  const list = required(value, boundedList);
  if (!list.every(isLogReference)) throw invalidSyncMessage();
  return { references: list.map(({ key, value: entity }) => ({ key, value: entity })) };
}

export function decodeSyncServerMessage(value: unknown): SyncServerMessage | null {
  if (!isDynamicRecord(value)) return null;
  switch (value.type) {
    case "sync-changes": {
      const upserts = required(value.upserts, boundedList);
      if (!upserts.every(isUpsert)) throw invalidSyncMessage();
      return {
        type: "sync-changes",
        collection: required(value.collection, isSyncName),
        upserts: upserts.map(({ key, version, value: entity }) => ({ key, version, value: entity })),
        deletes: keyList(value.deletes),
        synced: required(value.synced, isBoolean),
      };
    }
    case "sync-barrier":
      return { type: "sync-barrier", id: required(value.id, isRequestId) };
    case "sync-unavailable":
      return { type: "sync-unavailable", collection: required(value.collection, isSyncName) };
    case "sync-log-changes":
      return {
        type: "sync-log-changes",
        log: required(value.log, isSyncName),
        rows: logRows(value.rows),
        deletes: keyList(value.deletes),
        cursor: required(value.cursor, isCursor),
        reset: required(value.reset, isBoolean),
        olderCursor: nullable(value.olderCursor ?? null, isCursor),
        synced: required(value.synced, isBoolean),
        ...logReferences(value.references),
      };
    case "sync-log-page":
      return {
        type: "sync-log-page",
        log: required(value.log, isSyncName),
        id: required(value.id, isRequestId),
        rows: logRows(value.rows),
        olderCursor: nullable(value.olderCursor ?? null, isCursor),
        done: required(value.done, isBoolean),
        ...logReferences(value.references),
      };
    default:
      return null;
  }
}
