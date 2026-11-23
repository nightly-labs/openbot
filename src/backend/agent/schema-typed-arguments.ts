import { type DynamicRecord, isDynamicRecord } from "@openbot/contracts/runtime-values";

type TypedText = number | boolean | null | readonly unknown[] | DynamicRecord;

export function withSchemaTypes(args: DynamicRecord, schema: DynamicRecord): DynamicRecord {
  const typed = typedValue(args, schema);
  return isDynamicRecord(typed) ? typed : args;
}

function typedValue<Value>(value: Value, schema: DynamicRecord): Value | TypedText {
  const typed = typeof value === "string" ? typedText(value, acceptedTypes(schema)) : value;
  if (Array.isArray(typed)) {
    const items = subschema(schema, (branch) => (isDynamicRecord(branch.items) ? [branch.items] : []));
    return items === undefined ? typed : typed.map((item) => typedValue(item, items));
  }
  if (!isDynamicRecord(typed)) return typed;
  return Object.fromEntries(
    Object.entries(typed).map(([key, item]) => {
      const property = subschema(schema, (branch) => {
        if (isDynamicRecord(branch.properties) && Object.hasOwn(branch.properties, key))
          return [branch.properties[key]];
        if (isDynamicRecord(branch.additionalProperties)) return [branch.additionalProperties];
        return isDynamicRecord(branch.properties) && branch.additionalProperties !== false ? [{}] : [];
      });
      return [key, property === undefined ? item : typedValue(item, property)];
    }),
  );
}

function unionOf(schema: DynamicRecord): unknown[] {
  return [schema.anyOf, schema.oneOf].flatMap((list) => (Array.isArray(list) ? list : []));
}

function branches(schema: DynamicRecord): DynamicRecord[] {
  return [schema, ...unionOf(schema).filter(isDynamicRecord).flatMap(branches)];
}

function subschema(schema: DynamicRecord, part: (branch: DynamicRecord) => unknown[]): DynamicRecord | undefined {
  const found = branches(schema).flatMap(part);
  if (found.length === 0) return undefined;
  const [only] = found;
  return found.length === 1 && isDynamicRecord(only) ? only : { anyOf: found };
}

function acceptedTypes(schema: DynamicRecord): Set<string> | null {
  const union = unionOf(schema);
  if (schema.type === undefined && union.length === 0) return null;
  const types = new Set([schema.type].flat().filter((type) => typeof type === "string"));
  for (const branch of union) {
    const branchTypes = isDynamicRecord(branch) ? acceptedTypes(branch) : null;
    if (branchTypes === null) return null;
    for (const type of branchTypes) types.add(type);
  }
  return types;
}

const NUMBER_TEXT = /^-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?$/u;

function typedText<Text extends string>(text: Text, types: Set<string> | null): Text | TypedText {
  if (types === null || types.has("string")) return text;
  const trimmed = text.trim();
  if ((types.has("number") || types.has("integer")) && NUMBER_TEXT.test(trimmed)) {
    const number = Number(trimmed);
    if (Number.isInteger(number) ? Number.isSafeInteger(number) : Number.isFinite(number) && types.has("number"))
      return number;
  }
  if (types.has("boolean") && (trimmed === "true" || trimmed === "false")) return trimmed === "true";
  if (types.has("null") && trimmed === "null") return null;
  if ((types.has("array") && trimmed.startsWith("[")) || (types.has("object") && trimmed.startsWith("{"))) {
    try {
      const parsed = JSON.parse(trimmed);
      if (Array.isArray(parsed) ? types.has("array") : isDynamicRecord(parsed) && types.has("object")) return parsed;
    } catch {}
  }
  return text;
}
