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
