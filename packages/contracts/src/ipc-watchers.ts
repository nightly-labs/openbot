import { INPUT_LIMITS } from "./input-limits";
import { isBoundedString, isIdentifier } from "./ipc-bounded-values";
import { isBoolean, isDynamicRecord, isOneOf, isString } from "./runtime-values";

export const WATCHER_MINIMUM_INTERVAL_MINUTES = 3;
export const WATCHER_MAXIMUM_INTERVAL_MINUTES = 1440;

export type WatcherSource = { kind: "gmail"; query: string; labelIds?: string[] } | { kind: "web"; url: string };

export type WatcherSelector = {
  css?: string;
  xpath?: string;
  textAnchor?: string;
};

export type WatcherCondition = {
  /** Case-insensitive substring on normalized facts. Absent means any change fires. */
  textContains?: string;
};

export type WatcherHealth = "ok" | "weak" | "quarantined";

/** How the last check read its bytes. Stored per check, so health shows fetch versus browser. */
export type WatcherMode = "fetch" | "browser" | "gmail";

export interface Watcher {
  id: string;
  agentId: string;
  routineId: string;
  name: string;
  active: boolean;
  intervalMinutes: number;
  source: WatcherSource;
  selector: WatcherSelector | null;
  condition: WatcherCondition;
  health: WatcherHealth;
  lastCheckedAt: string | null;
  nextCheckAt: string;
  lastStateHash: string | null;
  lastKeptText: string | null;
  lastMode: WatcherMode | null;
  errorCount: number;
  createdAt: string;
  updatedAt: string;
}

export interface WatcherMatch {
  id: string;
  watcherId: string;
  agentId: string;
  sourceId: string;
  summary: string;
  diff: string;
  createdAt: string;
  consumedRunId: string | null;
}

export interface CreateWatcherInput {
  agentId: string;
  routineId: string;
  name: string;
  active: boolean;
  intervalMinutes: number;
  source: WatcherSource;
  selector?: WatcherSelector | null;
  condition?: WatcherCondition;
}

export interface UpdateWatcherInput {
  agentId: string;
  watcherId: string;
  name?: string;
  active?: boolean;
  intervalMinutes?: number;
  source?: WatcherSource;
  selector?: WatcherSelector | null;
  condition?: WatcherCondition;
}

export interface DeleteWatcherInput {
  agentId: string;
  watcherId: string;
}

export interface TestWatcherInput {
  agentId: string;
  watcherId: string;
}

export interface ListWatcherMatchesInput {
  agentId: string;
  watcherId: string;
  limit?: number;
}

export function isWatcherSource(value: unknown): value is WatcherSource {
  if (!isDynamicRecord(value) || !isString(value.kind)) return false;
  if (value.kind === "gmail") {
    if (!isBoundedString(value.query, INPUT_LIMITS.watcherQuery)) return false;
    if (value.query.trim().length === 0) return false;
    if (value.labelIds === undefined) return true;
    return (
      Array.isArray(value.labelIds) &&
      value.labelIds.length <= 10 &&
      value.labelIds.every((entry) => isBoundedString(entry, INPUT_LIMITS.identifier) && entry.length > 0)
    );
  }
  if (value.kind === "web") {
    return isBoundedString(value.url, INPUT_LIMITS.browserUrl) && value.url.startsWith("https://");
  }
  return false;
}

export function isWatcherSelector(value: unknown): value is WatcherSelector {
  if (!isDynamicRecord(value)) return false;
  const css = value.css;
  const xpath = value.xpath;
  const textAnchor = value.textAnchor;
  if (css !== undefined && !isBoundedString(css, INPUT_LIMITS.watcherSelector)) return false;
  if (xpath !== undefined && !isBoundedString(xpath, INPUT_LIMITS.watcherSelector)) return false;
  if (textAnchor !== undefined && !isBoundedString(textAnchor, INPUT_LIMITS.watcherText)) return false;
  return (
    (isString(css) && css.trim().length > 0) ||
    (isString(xpath) && xpath.trim().length > 0) ||
    (isString(textAnchor) && textAnchor.trim().length > 0)
  );
}

export function isWatcherCondition(value: unknown): value is WatcherCondition {
  if (value === undefined) return true;
  if (!isDynamicRecord(value)) return false;
  if (value.textContains === undefined) return true;
  return isBoundedString(value.textContains, INPUT_LIMITS.watcherText) && value.textContains.trim().length > 0;
}

export function isWatcherHealth(value: unknown): value is WatcherHealth {
  return isOneOf(["ok", "weak", "quarantined"] as const, value);
}

export function isWatcherMode(value: unknown): value is WatcherMode {
  return isOneOf(["fetch", "browser", "gmail"] as const, value);
}

export function isWatcher(value: unknown): value is Watcher {
  if (!isDynamicRecord(value)) return false;
  const name = value.name;
  const lastCheckedAt = value.lastCheckedAt;
  const nextCheckAt = value.nextCheckAt;
  const lastStateHash = value.lastStateHash;
  const lastKeptText = value.lastKeptText;
  const lastMode = value.lastMode;
  const errorCount = value.errorCount;
  const createdAt = value.createdAt;
  const updatedAt = value.updatedAt;
  return (
    isIdentifier(value.id) &&
    isIdentifier(value.agentId) &&
    isIdentifier(value.routineId) &&
    isString(name) &&
    name.trim().length > 0 &&
    name.length <= INPUT_LIMITS.watcherName &&
    isBoolean(value.active) &&
    isWatcherInterval(value.intervalMinutes) &&
    isWatcherSource(value.source) &&
    (value.selector === null || isWatcherSelector(value.selector)) &&
    isWatcherCondition(value.condition) &&
    isWatcherHealth(value.health) &&
    (lastCheckedAt === null || isString(lastCheckedAt)) &&
    isString(nextCheckAt) &&
    (lastStateHash === null || isString(lastStateHash)) &&
    (lastKeptText === null || isBoundedString(lastKeptText, INPUT_LIMITS.watcherKeptText)) &&
    (lastMode === null || isWatcherMode(lastMode)) &&
    typeof errorCount === "number" &&
    Number.isInteger(errorCount) &&
    errorCount >= 0 &&
    isString(createdAt) &&
    isString(updatedAt)
  );
}

export function isWatcherInterval(value: unknown): value is number {
  return (
    typeof value === "number" &&
    Number.isInteger(value) &&
    value >= WATCHER_MINIMUM_INTERVAL_MINUTES &&
    value <= WATCHER_MAXIMUM_INTERVAL_MINUTES
  );
}

export function isWatcherMatch(value: unknown): value is WatcherMatch {
  return (
    isDynamicRecord(value) &&
    isIdentifier(value.id) &&
    isIdentifier(value.watcherId) &&
    isIdentifier(value.agentId) &&
    isBoundedString(value.sourceId, INPUT_LIMITS.identifier) &&
    isBoundedString(value.summary, INPUT_LIMITS.watcherText) &&
    isBoundedString(value.diff, INPUT_LIMITS.messageText) &&
    isBoundedString(value.createdAt, 160) &&
    (value.consumedRunId === null || isIdentifier(value.consumedRunId))
  );
}
