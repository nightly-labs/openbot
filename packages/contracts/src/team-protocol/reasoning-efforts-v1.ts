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

/**
 * A copy of a JSON value for a peer without reasoning-efforts-v1: each effort field has the nearest
 * level that the peer knows. Only the effort fields change, so a workflow step `effort` and text stay
 * as they are.
 */
export function withLegacyReasoningEfforts(value: unknown): JsonValue {
  const json: JsonValue = JSON.parse(JSON.stringify(value ?? null));
  return legacyEfforts(json);
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
