import { type DynamicRecord, isDynamicRecord } from "@openbot/contracts/runtime-values";

/** What a text value can become: a number, a boolean, null, or a JSON array or object. */
type TypedText = number | boolean | null | readonly unknown[] | DynamicRecord;

/**
 * Some model paths see the untyped values of `tool_call.arguments` as text, so their models send `3` as
 * `"3"` and `true` as `"true"`, and the target tool refuses the call (#9980; Kimi had the same, #5742).
 * The target's schema says which type the value must have, so a text value changes to that type only
 * when the schema does not accept text and the text is an exact number, boolean, `null` or JSON array
 * or object. All other values stay as the model sent them, and the target tool still checks them.
 */
export function withSchemaTypes(args: DynamicRecord, schema: DynamicRecord): DynamicRecord {
  const typed = typedValue(args, schema);
  return isDynamicRecord(typed) ? typed : args;
}

/** The value, or the typed value of a text value and of the parts of an array or object. */
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
        // An object branch that does not close its keys takes this key with any value, so it stays as sent.
        return isDynamicRecord(branch.properties) && branch.additionalProperties !== false ? [{}] : [];
      });
      return [key, property === undefined ? item : typedValue(item, property)];
    }),
  );
}

/** The `anyOf` and `oneOf` branches of a schema. */
function unionOf(schema: DynamicRecord): unknown[] {
  return [schema.anyOf, schema.oneOf].flatMap((list) => (Array.isArray(list) ? list : []));
}

/** The schema and the branches of its `anyOf` and `oneOf`, also nested ones. */
function branches(schema: DynamicRecord): DynamicRecord[] {
  return [schema, ...unionOf(schema).filter(isDynamicRecord).flatMap(branches)];
}

/** The schema of a part of a value, from each branch that has one, or undefined when no branch has one. */
function subschema(schema: DynamicRecord, part: (branch: DynamicRecord) => unknown[]): DynamicRecord | undefined {
  const found = branches(schema).flatMap(part);
  if (found.length === 0) return undefined;
  const [only] = found;
  return found.length === 1 && isDynamicRecord(only) ? only : { anyOf: found };
}

/** The JSON types that a schema accepts, or null when a branch accepts a type that it does not name. */
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
    // A whole number past the safe range changes its digits, so it stays text, and the tool refuses it.
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
    } catch {
      // Text that is not JSON stays text, and the target tool refuses it.
    }
  }
  return text;
}
