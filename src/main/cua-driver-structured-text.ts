import { type DynamicRecord, isDynamicRecord } from "@openbot/contracts/runtime-values";

const STRUCTURED_TEXT_LABEL = "structuredContent as JSON, copied by OpenBot for clients that show only text:";

const MAX_STRUCTURED_TEXT_CHARS = 65_536;

const ELEMENT_ADDRESS_NOTE =
  "To act on an element, send this pid, window_id and snapshot_id with the element_index that the tree in the result text shows.";

const REPEATED_TEXT_MIN_CHARS = 256;
const BINARY_TEXT_MIN_CHARS = 1_024;
const BASE64_TEXT = /^[A-Za-z0-9+/]+={0,2}$/u;

export function rewriteCallAnswer(parsed: DynamicRecord): string | null {
  if (parsed.ok === false) return refusalWithMessage(parsed);
  if (parsed.ok !== true) return null;
  const copied = withStructuredText(parsed.result);
  const result = withErrorReason(copied ?? parsed.result) ?? copied;
  return result ? JSON.stringify({ ...parsed, result }) : null;
}

export function parseAnswerLine(line: string): DynamicRecord | null {
  let unsafeInteger = false;
  let parsed: unknown;
  try {
    parsed = JSON.parse(line, (_key, value: unknown) => {
      if (typeof value === "number" && Number.isInteger(value) && !Number.isSafeInteger(value)) unsafeInteger = true;
      return value;
    });
  } catch {
    return null;
  }
  return !unsafeInteger && isDynamicRecord(parsed) ? parsed : null;
}

function withErrorReason(result: unknown): DynamicRecord | null {
  if (!isDynamicRecord(result) || result.isError !== true || !Array.isArray(result.content)) return null;
  const structured = result.structuredContent ?? {};
  if (!isDynamicRecord(structured) || Object.hasOwn(structured, "message")) return null;
  const message = textItems(result.content)
    .filter((text) => text.length > 0 && !text.startsWith(STRUCTURED_TEXT_LABEL))
    .join("\n");
  if (message.length === 0) return null;
  const marked = ["code", "refusal", "status"].some((key) => Object.hasOwn(structured, key));
  const code = marked ? {} : { code: "tool_invocation_failed" };
  return { ...result, structuredContent: { ...structured, ...code, message } };
}

function refusalWithMessage(answer: DynamicRecord): string | null {
  const { error, exit_code: exitCode } = answer;
  if (typeof error !== "string" || error.length === 0) return null;
  return JSON.stringify({
    ok: true,
    result: {
      content: [{ type: "text", text: error }],
      isError: true,
      structuredContent: {
        exit_code: typeof exitCode === "number" ? exitCode : 1,
        code: "tool_invocation_failed",
        message: error,
      },
    },
  });
}

function withStructuredText(result: unknown): DynamicRecord | null {
  if (!isDynamicRecord(result) || !Array.isArray(result.content)) return null;
  const structured = result.structuredContent;
  if (!isDynamicRecord(structured)) return null;
  const texts = textItems(result.content);
  if (texts.some((text) => text.startsWith(STRUCTURED_TEXT_LABEL))) return null;
  const copy = compactCopy(structured, texts);
  if (Object.keys(copy).length === 0) return null;
  return { ...result, content: [...result.content, { type: "text", text: structuredText(copy) }] };
}

function textItems(content: readonly unknown[]): string[] {
  return content.flatMap((item) =>
    isDynamicRecord(item) && item.type === "text" && typeof item.text === "string" ? [item.text] : [],
  );
}

function compactCopy(structured: DynamicRecord, texts: readonly string[]): DynamicRecord {
  const elements = structured.elements;
  const hasElements = Array.isArray(elements);
  const fields = Object.entries(structured)
    .filter(([key]) => !(hasElements && (key === "elements" || key === "_note")))
    .map(([key, value]) => [key, isRepeatedText(value, texts) ? "[the same text is in the result text above]" : value]);
  const address = hasElements && elements.length > 0 ? elementAddress(elements, structured.snapshot_id) : {};
  return { ...Object.fromEntries(fields), ...address };
}

function elementAddress(elements: readonly unknown[], snapshotId: unknown): DynamicRecord {
  if (typeof snapshotId === "string") return { element_address: ELEMENT_ADDRESS_NOTE };
  const tokens: Record<string, string> = {};
  for (const element of elements) {
    if (!isDynamicRecord(element)) continue;
    const { element_index: index, element_token: token } = element;
    if (typeof index === "number" && typeof token === "string") tokens[String(index)] = token;
  }
  return Object.keys(tokens).length > 0 ? { element_tokens: tokens } : {};
}

function isRepeatedText(value: unknown, texts: readonly string[]): boolean {
  return typeof value === "string" && value.length >= REPEATED_TEXT_MIN_CHARS && texts.some((t) => t.includes(value));
}

function readableText(value: string): string {
  return isBinaryText(value) ? `[${value.length} characters of base64 data]` : value;
}

function isBinaryText(value: string): boolean {
  if (value.length < BINARY_TEXT_MIN_CHARS) return false;
  return (value.startsWith("data:") && value.includes(";base64,")) || BASE64_TEXT.test(value.replace(/\r?\n/gu, ""));
}

function structuredText(copy: DynamicRecord): string {
  const json = JSON.stringify(copy, (_key, value) => (typeof value === "string" ? readableText(value) : value));
  if (json.length <= MAX_STRUCTURED_TEXT_CHARS) return `${STRUCTURED_TEXT_LABEL}\n${json}`;
  const lastKept = json.charCodeAt(MAX_STRUCTURED_TEXT_CHARS - 1);
  const end = lastKept >= 0xd800 && lastKept <= 0xdbff ? MAX_STRUCTURED_TEXT_CHARS - 1 : MAX_STRUCTURED_TEXT_CHARS;
  return `${STRUCTURED_TEXT_LABEL}\n${json.slice(0, end)}\n[OpenBot cut this copy at ${MAX_STRUCTURED_TEXT_CHARS} of ${json.length} characters. Ask the tool for less: get_window_state takes query and max_elements.]`;
}
