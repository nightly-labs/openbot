// A text copy of what the Computer Use driver says only in `structuredContent`.
//
// The driver puts a short summary in a tool result's `content` - `list_windows` says "Found 5
// window(s)." - and the data an agent acts on, such as window ids, bounds and element tokens, in
// `structuredContent`. A provider that shows the model only `content` gives it nothing to act on:
// opencode builds the tool output from `content` alone. So the tap adds one text item that holds a
// compact JSON copy of the structured result.
//
// A provider that reads `structuredContent` does not see the copy. Codex sends the model the
// serialized `structuredContent` alone when it is present, and Claude keeps only the non-text items
// beside it. So the copy costs those providers no model tokens, and the providers that need it get
// it.
//
// The structured result itself is never changed: the driver's proxy checks it against the tool's
// output schema, and a result that fails the check reaches the agent as an error.

import { type DynamicRecord, isDynamicRecord } from "@openbot/contracts/runtime-values";

/** The first line of the copy, which also marks a result that already holds one. */
export const STRUCTURED_TEXT_LABEL = "structuredContent as JSON, copied by OpenBot for clients that show only text:";

/**
 * The most characters of JSON the copy holds.
 *
 * `get_window_state` returns an accessibility tree of about 190 KB and an element list many times
 * larger. A copy of all of it would fill the model's context with one call, so the copy stops here
 * and tells the agent how to ask for less.
 */
export const MAX_STRUCTURED_TEXT_CHARS = 65_536;

/** A string this long that the result text already holds is not copied again. */
const REPEATED_TEXT_MIN_CHARS = 256;
/** A string this long made only of base64 characters is image or file data, not something to read. */
const BINARY_TEXT_MIN_CHARS = 1_024;
const BASE64_TEXT = /^[A-Za-z0-9+/=\s]+$/u;
/**
 * An integer literal JavaScript cannot hold exactly.
 *
 * A rewritten answer is parsed and serialized again, which would round such a number. No field the
 * driver sends is that large today, but an answer that has one is passed on unchanged rather than
 * changed in a way nobody asked for.
 */
const UNSAFE_INTEGER = /[:,[]\s*-?\d{16,}/u;

/**
 * One daemon answer line with the copy added, or `null` to pass the line on unchanged.
 *
 * The line is the daemon's own answer to a `call`: `{"ok":true,"result":{content, isError,
 * structuredContent}}`. Anything else - a refusal, an answer with no structured result, a line
 * that is not JSON - is `null`.
 */
export function rewriteCallAnswer(line: string): string | null {
  if (UNSAFE_INTEGER.test(line)) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(line);
  } catch {
    return null;
  }
  if (!isDynamicRecord(parsed) || parsed.ok !== true) return null;
  const result = withStructuredText(parsed.result);
  return result ? JSON.stringify({ ...parsed, result }) : null;
}

/**
 * The tool result with one text item added that copies `structuredContent`, or `null` when there
 * is nothing to add.
 *
 * Nothing is added when the result has no structured content, or when its text already holds the
 * copy. Every existing item, images included, stays as it is and in its place.
 */
export function withStructuredText(result: unknown): DynamicRecord | null {
  if (!isDynamicRecord(result) || !Array.isArray(result.content)) return null;
  const structured = result.structuredContent;
  if (!isDynamicRecord(structured)) return null;
  const texts = result.content.flatMap((item) =>
    isDynamicRecord(item) && item.type === "text" && typeof item.text === "string" ? [item.text] : [],
  );
  if (texts.some((text) => text.startsWith(STRUCTURED_TEXT_LABEL))) return null;
  const copy = compactCopy(structured, texts);
  if (Object.keys(copy).length === 0) return null;
  return { ...result, content: [...result.content, { type: "text", text: structuredText(copy) }] };
}

/**
 * The fields worth reading, without the data that is not.
 *
 * `elements` becomes `element_tokens`, a map from each element index to its token: the tree
 * already names every element by its index, and the full element objects are what make the
 * result megabytes long. The driver's `_note` goes with it, because it points at `elements`.
 * Base64 data anywhere below is left out when the copy is serialized; see `structuredText`.
 */
function compactCopy(structured: DynamicRecord, texts: readonly string[]): DynamicRecord {
  const elements = structured.elements;
  const hasElements = Array.isArray(elements);
  const fields = Object.entries(structured)
    .filter(([key]) => !(hasElements && (key === "elements" || key === "_note")))
    .map(([key, value]) => [key, isRepeatedText(value, texts) ? "[the same text is in the result text above]" : value]);
  const tokens = hasElements ? elementTokens(elements) : {};
  return {
    ...Object.fromEntries(fields),
    ...(Object.keys(tokens).length > 0 ? { element_tokens: tokens } : {}),
  };
}

function isRepeatedText(value: unknown, texts: readonly string[]): boolean {
  return typeof value === "string" && value.length >= REPEATED_TEXT_MIN_CHARS && texts.some((t) => t.includes(value));
}

function elementTokens(elements: readonly unknown[]): Record<string, string> {
  const tokens: Record<string, string> = {};
  for (const element of elements) {
    if (!isDynamicRecord(element)) continue;
    const { element_index: index, element_token: token } = element;
    if (typeof index === "number" && typeof token === "string") tokens[String(index)] = token;
  }
  return tokens;
}

/** A string to copy, or a short note in place of image or file data that nobody reads as text. */
function readableText(value: string): string {
  return isBinaryText(value) ? `[${value.length} characters of base64 data]` : value;
}

function isBinaryText(value: string): boolean {
  if (value.length < BINARY_TEXT_MIN_CHARS) return false;
  return (value.startsWith("data:") && value.includes(";base64,")) || BASE64_TEXT.test(value);
}

function structuredText(copy: DynamicRecord): string {
  const json = JSON.stringify(copy, (_key, value) => (typeof value === "string" ? readableText(value) : value));
  if (json.length <= MAX_STRUCTURED_TEXT_CHARS) return `${STRUCTURED_TEXT_LABEL}\n${json}`;
  return `${STRUCTURED_TEXT_LABEL}\n${json.slice(0, MAX_STRUCTURED_TEXT_CHARS)}\n[OpenBot cut this copy at ${MAX_STRUCTURED_TEXT_CHARS} of ${json.length} characters. Ask the tool for less: get_window_state takes query and max_elements.]`;
}
