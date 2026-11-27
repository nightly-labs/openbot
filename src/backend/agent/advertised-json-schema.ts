import { isDynamicRecord } from "@openbot/contracts/runtime-values";
import { z } from "zod";

type JsonValue = null | boolean | number | string | JsonValue[] | JsonObject;
interface JsonObject {
  [key: string]: JsonValue;
}
type ObjectBranch = JsonObject & { properties: JsonObject };

const MERGEABLE_KEYS = new Set(["type", "properties", "required", "additionalProperties"]);

const isObject = (value: JsonValue | undefined): value is JsonObject =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const isBareAnyOf = (value: JsonValue | undefined): value is { anyOf: JsonValue[] } =>
  isObject(value) && Array.isArray(value.anyOf) && Object.keys(value).length === 1;

const isObjectBranch = (value: JsonValue): value is ObjectBranch =>
  isObject(value) &&
  value.type === "object" &&
  isObject(value.properties) &&
  Object.keys(value).every((key) => MERGEABLE_KEYS.has(key));

const VALIDATION_KEYS = new Set([
  "pattern",
  "minLength",
  "maxLength",
  "minItems",
  "maxItems",
  "uniqueItems",
  "minimum",
  "maximum",
  "exclusiveMinimum",
  "exclusiveMaximum",
  "multipleOf",
  "minProperties",
  "maxProperties",
]);

const SCHEMA_MAPS = new Set(["properties", "patternProperties", "definitions", "$defs"]);

function tagValue(property: JsonValue | undefined): string | undefined {
  if (!isObject(property)) return undefined;
  if (typeof property.const === "string") return property.const;
  return Array.isArray(property.enum) && property.enum.length === 1 && typeof property.enum[0] === "string"
    ? property.enum[0]
    : undefined;
}

function mergeTaggedObjects(branches: readonly JsonValue[]): JsonObject | undefined {
  const objects = branches.filter(isObjectBranch);
  const [first] = objects;
  if (first === undefined || objects.length < 2 || objects.length !== branches.length) return undefined;
  const tag = Object.keys(first.properties).find((key) => {
    const values = objects.map((object) => tagValue(object.properties[key]));
    return values.every((value) => value !== undefined) && new Set(values).size === values.length;
  });
  if (tag === undefined) return undefined;
  const properties: JsonObject = {
    [tag]: { type: "string", enum: objects.flatMap((object) => tagValue(object.properties[tag]) ?? []) },
  };
  for (const object of objects) {
    for (const [name, property] of Object.entries(object.properties)) {
      if (name === tag) continue;
      const seen = properties[name];
      if (seen === undefined) {
        properties[name] = property;
        continue;
      }
      const options = isBareAnyOf(seen) ? seen.anyOf : [seen];
      const text = JSON.stringify(property);
      if (!options.some((option) => JSON.stringify(option) === text))
        properties[name] = { anyOf: [...options, property] };
    }
  }
  const requiredOf = (object: ObjectBranch) =>
    Array.isArray(object.required) ? object.required.filter((name) => typeof name === "string") : [];
  const required = requiredOf(first).filter(
    (name) => name !== tag && objects.every((object) => requiredOf(object).includes(name)),
  );
  return {
    type: "object",
    properties,
    required: [tag, ...required],
    ...(objects.every((object) => object.additionalProperties === false) ? { additionalProperties: false } : {}),
  };
}

const VALUE_KEYS = new Set(["const", "enum", "default", "examples"]);

function plainJson(value: unknown): JsonValue | undefined {
  if (value === null || typeof value === "boolean" || typeof value === "number" || typeof value === "string")
    return value;
  if (Array.isArray(value)) return value.flatMap((item) => plainJson(item) ?? []);
  if (!isDynamicRecord(value)) return undefined;
  const result: JsonObject = {};
  for (const [key, item] of Object.entries(value)) {
    const copied = plainJson(item);
    if (copied !== undefined) result[key] = copied;
  }
  return result;
}

function compactMap(map: unknown): JsonValue | undefined {
  if (!isDynamicRecord(map)) return compact(map);
  const result: JsonObject = {};
  for (const [name, value] of Object.entries(map)) {
    const compacted = compact(value);
    if (compacted !== undefined) result[name] = compacted;
  }
  return result;
}

function uniqueBranches(branches: readonly JsonValue[]): JsonValue[] {
  const seen = new Set<string>();
  return branches.filter((branch) => {
    const text = JSON.stringify(branch);
    if (seen.has(text)) return false;
    seen.add(text);
    return true;
  });
}

function compact(schema: unknown): JsonValue | undefined {
  if (schema === null || typeof schema === "boolean" || typeof schema === "number" || typeof schema === "string")
    return schema;
  if (Array.isArray(schema)) return schema.flatMap((item) => compact(item) ?? []);
  if (!isDynamicRecord(schema)) return undefined;
  let result: JsonObject = {};
  for (const [key, value] of Object.entries(schema)) {
    if (key === "$schema" || VALIDATION_KEYS.has(key)) continue;
    const compacted = VALUE_KEYS.has(key)
      ? plainJson(value)
      : SCHEMA_MAPS.has(key)
        ? compactMap(value)
        : compact(value);
    if (compacted !== undefined) result[key] = compacted;
  }
  if (Array.isArray(result.anyOf)) {
    result.anyOf = uniqueBranches(result.anyOf.flatMap((branch) => (isBareAnyOf(branch) ? branch.anyOf : [branch])));
    const [only] = result.anyOf;
    if (result.anyOf.length === 1 && isObject(only)) {
      const { anyOf: _anyOf, ...rest } = result;
      result = { ...only, ...rest };
    }
  }
  for (const union of ["oneOf", "anyOf"] as const) {
    const branches = result[union];
    if (!Array.isArray(branches)) continue;
    const merged = mergeTaggedObjects(branches);
    if (merged !== undefined && JSON.stringify(merged).length < JSON.stringify(branches).length) {
      const { [union]: _union, ...rest } = result;
      result = { ...merged, ...rest };
    }
    break;
  }
  return result;
}

export function advertisedJsonSchema(schema: z.ZodType): JsonObject {
  const advertised = compact(z.toJSONSchema(schema, { target: "draft-7", unrepresentable: "any" }));
  if (!isObject(advertised)) throw new Error("A tool input schema must be an object.");
  return advertised;
}

export function advertisedZodShape(schema: z.ZodType): Record<string, z.ZodType> {
  const advertised = advertisedJsonSchema(schema);
  const properties = isObject(advertised.properties) ? advertised.properties : {};
  const required = new Set(Array.isArray(advertised.required) ? advertised.required : []);
  return Object.fromEntries(
    Object.entries(properties).map(([name, property]) => {
      const value = z.unknown().meta(isObject(property) ? property : {});
      return [name, required.has(name) ? value : value.optional()];
    }),
  );
}
