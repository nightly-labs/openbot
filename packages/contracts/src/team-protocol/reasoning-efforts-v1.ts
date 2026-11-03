// Frozen optional reasoning-efforts-v1 wire contract.
//
// What it grants, recorded here because freezing it makes it permanent: an agent `reasoningEffort`,
// a model option `defaultReasoningEffort` and each of its `supportedReasoningEfforts` can be `none`,
// `minimal` and `ultra`, in addition to the five levels that protocol 8 shipped with. The routes and
// events do not change. A peer without this capability gets the nearest of the five levels in each
// of these fields: `none` and `minimal` are `low`, `ultra` is `max`, and a list keeps each level once.
// The list does not follow IPC changes; another level needs a second capability string.
import { type AgentReasoningEffort, isReasoningEffort, legacyReasoningEffort } from "../ipc-agent-identity";

export const TEAM_REASONING_EFFORTS_CAPABILITY = "reasoning-efforts-v1";

export const TEAM_REASONING_EFFORTS = [
  "none",
  "minimal",
  "low",
  "medium",
  "high",
  "xhigh",
  "max",
  "ultra",
] as const satisfies readonly AgentReasoningEffort[];

type JsonValue = string | number | boolean | null | JsonValue[] | { [key: string]: JsonValue };

const EFFORT_FIELDS = new Set(["reasoningEffort", "defaultReasoningEffort", "supportedReasoningEfforts"]);

/**
 * The value for a peer without reasoning-efforts-v1: each effort field has the nearest level that the
 * peer knows. Only the effort fields change, so a workflow step `effort` and text stay as they are.
 * A value with no new level is returned as it is, so most responses and events are not copied.
 */
export function withLegacyReasoningEfforts<T>(value: T): T | JsonValue {
  if (!hasNewReasoningEffort(value, "")) return value;
  const json: JsonValue = JSON.parse(JSON.stringify(value));
  return legacyEfforts(json);
}

function hasNewReasoningEffort(value: unknown, key: string): boolean {
  if (EFFORT_FIELDS.has(key)) {
    const levels = Array.isArray(value) ? value : [value];
    return levels.some((level) => isReasoningEffort(level) && legacyReasoningEffort(level) !== level);
  }
  if (Array.isArray(value)) return value.some((item) => hasNewReasoningEffort(item, ""));
  if (value === null || typeof value !== "object") return false;
  return Object.entries(value).some(([field, child]) => hasNewReasoningEffort(child, field));
}

function legacyEfforts(value: JsonValue, key = ""): JsonValue {
  if (Array.isArray(value)) {
    if (key !== "supportedReasoningEfforts") return value.map((item) => legacyEfforts(item));
    const levels = value.map((item) => (isReasoningEffort(item) ? legacyReasoningEffort(item) : item));
    return levels.filter((level, index) => levels.indexOf(level) === index);
  }
  if (typeof value === "string") {
    return (key === "reasoningEffort" || key === "defaultReasoningEffort") && isReasoningEffort(value)
      ? legacyReasoningEffort(value)
      : value;
  }
  if (value === null || typeof value !== "object") return value;
  const result: { [key: string]: JsonValue } = {};
  for (const [field, child] of Object.entries(value)) result[field] = legacyEfforts(child, field);
  return result;
}
