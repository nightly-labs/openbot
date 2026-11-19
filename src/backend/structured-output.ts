import { type DynamicRecord, isDynamicRecord } from "@openbot/contracts/runtime-values";

export class StructuredOutputError extends Error {}

export function extractJsonObject(response: string): DynamicRecord {
  const unfenced = response
    .trim()
    .replace(/^```(?:json)?\s*/u, "")
    .replace(/\s*```$/u, "")
    .trim();
  const candidate = unfenced.startsWith("{") ? unfenced : (balancedObject(unfenced) ?? unfenced);
  let parsed: unknown;
  try {
    parsed = JSON.parse(candidate);
  } catch {
    throw new StructuredOutputError("The provider returned no JSON object.");
  }
  if (!isDynamicRecord(parsed)) throw new StructuredOutputError("The provider returned no JSON object.");
  return parsed;
}

function balancedObject(value: string): string | null {
  const start = value.indexOf("{");
  if (start < 0) return null;
  let depth = 0;
  let inString = false;
  let escaped = false;
  for (let index = start; index < value.length; index += 1) {
    const character = value[index];
    if (inString) {
      if (escaped) escaped = false;
      else if (character === "\\") escaped = true;
      else if (character === '"') inString = false;
      continue;
    }
    if (character === '"') inString = true;
    else if (character === "{") depth += 1;
    else if (character === "}") {
      depth -= 1;
      if (depth === 0) return value.slice(start, index + 1);
    }
  }
  return null;
}
