import { isIdentifier } from "../ipc-bounded-values";
import { isBoolean, isDynamicRecord, isNumber, isOneOf, isString } from "../runtime-values";
import type { TeamProtocolV8BaseJsonObject, TeamProtocolV8BaseJsonValue } from "./v8-base";

export const TEAM_CONTEXT_USAGE_CAPABILITY = "context-usage-v1";

const CONTEXT_USAGE_V1_CATEGORIES = [
  "systemPrompt",
  "memoryFiles",
  "tools",
  "skills",
  "toolResults",
  "messages",
  "other",
] as const;

const STATE_KEYS = ["botId", "threadId", "usage", "compaction"] as const;
const USAGE_KEYS = ["usedTokens", "windowTokens", "autoCompactAt", "nativeManaged", "estimated"] as const;
const CATEGORY_KEYS = ["category", "tokens"] as const;
const COMPACTION_KEYS = ["id", "startedAt", "status", "beforeTokens", "afterTokens", "expectedMs", "reason"] as const;
const COMPACTION_V1_STATUSES = ["running", "completed", "failed"] as const;
const COMPACTION_V1_REASONS = ["cacheExpiry"] as const;

function isJsonObject(value: TeamProtocolV8BaseJsonValue | undefined): value is TeamProtocolV8BaseJsonObject {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function pickKeys(value: TeamProtocolV8BaseJsonObject, keys: readonly string[]): TeamProtocolV8BaseJsonObject {
  const result: TeamProtocolV8BaseJsonObject = {};
  for (const key of keys) {
    const entry = value[key];
    if (entry !== undefined) result[key] = entry;
  }
  return result;
}

function pick(value: TeamProtocolV8BaseJsonValue, keys: readonly string[]): TeamProtocolV8BaseJsonValue {
  return isJsonObject(value) ? pickKeys(value, keys) : value;
}

function v1Usage(usage: TeamProtocolV8BaseJsonValue): TeamProtocolV8BaseJsonValue {
  if (!isJsonObject(usage)) return usage;
  const picked = pickKeys(usage, USAGE_KEYS);
  const { categories } = usage;
  if (categories === undefined) return picked;
  picked.categories = Array.isArray(categories)
    ? categories
        .filter(
          (row) => !isJsonObject(row) || !isString(row.category) || isOneOf(CONTEXT_USAGE_V1_CATEGORIES, row.category),
        )
        .map((row) => pick(row, CATEGORY_KEYS))
    : categories;
  return picked;
}

function v1Compaction(compaction: TeamProtocolV8BaseJsonValue): TeamProtocolV8BaseJsonValue {
  if (!isJsonObject(compaction)) return compaction;
  const picked = pickKeys(compaction, COMPACTION_KEYS);
  if (picked.reason !== undefined && !isOneOf(COMPACTION_V1_REASONS, picked.reason)) delete picked.reason;
  return picked;
}

function isCount(value: TeamProtocolV8BaseJsonValue | undefined): boolean {
  return isNumber(value) && Number.isFinite(value) && value >= 0;
}

function isOptionalCount(value: TeamProtocolV8BaseJsonValue | undefined): boolean {
  return value === undefined || isCount(value);
}

function isV1ContextState(state: TeamProtocolV8BaseJsonValue): boolean {
  if (!isJsonObject(state) || !isIdentifier(state.botId) || !isIdentifier(state.threadId)) return false;
  const { usage, compaction } = state;
  const validUsage =
    usage === null ||
    (isJsonObject(usage) &&
      isCount(usage.usedTokens) &&
      isNumber(usage.windowTokens) &&
      isCount(usage.windowTokens) &&
      usage.windowTokens > 0 &&
      isBoolean(usage.nativeManaged) &&
      (usage.estimated === undefined || isBoolean(usage.estimated)) &&
      (usage.autoCompactAt === null ||
        (isNumber(usage.autoCompactAt) && isCount(usage.autoCompactAt) && usage.autoCompactAt <= 1)) &&
      (usage.categories === undefined ||
        (Array.isArray(usage.categories) &&
          new Set(usage.categories.map((row) => (isJsonObject(row) ? row.category : null))).size ===
            usage.categories.length &&
          usage.categories.every((row) => isJsonObject(row) && isCount(row.tokens)))));
  const validCompaction =
    compaction === null ||
    (isJsonObject(compaction) &&
      isIdentifier(compaction.id) &&
      isCount(compaction.startedAt) &&
      isOneOf(COMPACTION_V1_STATUSES, compaction.status) &&
      isOptionalCount(compaction.beforeTokens) &&
      isOptionalCount(compaction.afterTokens) &&
      isOptionalCount(compaction.expectedMs));
  return validUsage && validCompaction;
}

function v1ContextStates(states: unknown, sending: boolean): TeamProtocolV8BaseJsonValue {
  if (!Array.isArray(states)) throw new Error("Invalid context states.");
  const json: TeamProtocolV8BaseJsonValue[] = JSON.parse(JSON.stringify(states));
  const projected = json.map((state) => {
    if (!isJsonObject(state)) return state;
    const picked = pickKeys(state, STATE_KEYS);
    if (state.usage !== undefined) picked.usage = v1Usage(state.usage);
    if (state.compaction !== undefined) picked.compaction = v1Compaction(state.compaction);
    return picked;
  });
  return sending ? projected.filter(isV1ContextState) : projected;
}

export function withRuntimeSnapshotContextUsage(
  projected: TeamProtocolV8BaseJsonValue,
  source: unknown,
  sending = false,
): TeamProtocolV8BaseJsonValue {
  if (!isDynamicRecord(projected) || projected.type !== "runtime-snapshot" || !isDynamicRecord(source)) {
    return projected;
  }
  const snapshot = projected.snapshot;
  const fromSnapshot = source.snapshot;
  if (!isDynamicRecord(snapshot) || !isDynamicRecord(fromSnapshot)) return projected;
  const result: TeamProtocolV8BaseJsonObject = { ...snapshot };
  if (fromSnapshot.contextStates !== undefined)
    result.contextStates = v1ContextStates(fromSnapshot.contextStates, sending);
  if (fromSnapshot.threadContextStates !== undefined) {
    result.threadContextStates = v1ContextStates(fromSnapshot.threadContextStates, sending);
  }
  return { ...projected, snapshot: result };
}
