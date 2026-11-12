import { isDynamicRecord } from "@openbot/contracts/runtime-values";
import { z } from "zod";

type JsonValue = null | boolean | number | string | JsonValue[] | JsonObject;
interface JsonObject {
  [key: string]: JsonValue;
}
type ObjectBranch = JsonObject & { properties: JsonObject };

/** The keys of a union branch that a merge can keep. A branch with any other key stays a union. */
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

/**
 * Keywords that only validate a value. OpenBot decodes each call with the Zod schema again, so they tell
 * the model nothing that a rejected call does not. Codex already drops them from its direct tools. A
 * limit that the model must know goes in the description.
 */
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

/** Keys whose value maps property names to schemas, so a property can have a keyword's name. */
const SCHEMA_MAPS = new Set(["properties", "patternProperties", "definitions", "$defs"]);

/** The one string value of a tag property, written by Zod as `const` or as a one-value `enum`. */
function tagValue(property: JsonValue | undefined): string | undefined {
  if (!isObject(property)) return undefined;
  if (typeof property.const === "string") return property.const;
  return Array.isArray(property.enum) && property.enum.length === 1 && typeof property.enum[0] === "string"
    ? property.enum[0]
    : undefined;
}

/**
 * One object for a union of objects that a tag property tells apart: each property once, the tag with
 * every value. Returns undefined when the branches are not such a union.
 */
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

/** Keys whose value is data, not a schema: it stays whole. */
const VALUE_KEYS = new Set(["const", "enum", "default", "examples"]);

/** A copy of a JSON value. Values that are not JSON are left out. */
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

/** The schemas of a property map, each compacted. The names stay, also a name such as `pattern`. */
function compactMap(map: unknown): JsonValue | undefined {
  if (!isDynamicRecord(map)) return compact(map);
  const result: JsonObject = {};
  for (const [name, value] of Object.entries(map)) {
    const compacted = compact(value);
    if (compacted !== undefined) result[name] = compacted;
  }
  return result;
}

/** Branches without exact copies; validation keywords that are gone can leave two branches the same. */
function uniqueBranches(branches: readonly JsonValue[]): JsonValue[] {
  const seen = new Set<string>();
  return branches.filter((branch) => {
    const text = JSON.stringify(branch);
    if (seen.has(text)) return false;
    seen.add(text);
    return true;
  });
}

/** The JSON of a schema without the parts that tell the model nothing. Values that are not JSON are left out. */
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
    // A merge that writes more than the union saves nothing, so the union stays.
    if (merged !== undefined && JSON.stringify(merged).length < JSON.stringify(branches).length) {
      const { [union]: _union, ...rest } = result;
      result = { ...merged, ...rest };
    }
    break;
  }
  return result;
}

/**
 * The input schema that OpenBot advertises for a tool. It leaves out JSON that each request pays for
 * and that tells the model nothing: `$schema`, validation-only keywords and nested or repeated `anyOf`. A union of
 * objects that a tag tells apart becomes one object. Calls are still
 * decoded with the Zod schema, so the rules of each branch still apply. `null` branches stay: a `null` value can mean "clear".
 */
export function advertisedJsonSchema(schema: z.ZodType): JsonObject {
  const advertised = compact(z.toJSONSchema(schema, { target: "draft-7", unrepresentable: "any" }));
  if (!isObject(advertised)) throw new Error("A tool input schema must be an object.");
  return advertised;
}

/**
 * A Zod shape whose JSON Schema is the advertised schema, for an SDK that takes a shape and makes the JSON
 * Schema itself. Each property is `z.unknown()` with its advertised JSON as metadata, which Zod writes in
 * place of the empty schema. The shape accepts any value, so the caller must decode the call with the
 * full schema.
 */
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
