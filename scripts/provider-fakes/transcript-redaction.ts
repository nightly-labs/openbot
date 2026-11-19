import { redactText } from "@openbot/logging";

export const REDACTED = "[redacted]";

export type TranscriptJson = string | number | boolean | null | TranscriptJson[] | TranscriptJsonObject;
export interface TranscriptJsonObject {
  [key: string]: TranscriptJson;
}

const KEPT_FIELDS: ReadonlySet<string> = new Set([
  "jsonrpc",
  "method",
  "type",
  "sessionUpdate",
  "stopReason",
  "status",
  "kind",
  "role",
  "phase",
  "category",
  "modelId",
  "currentModelId",
  "currentModeId",
  "currentValue",
  "configId",
  "optionId",
  "provider",
  "version",
]);

const ID_FIELDS: ReadonlySet<string> = new Set([
  "id",
  "sessionId",
  "threadId",
  "turnId",
  "itemId",
  "toolCallId",
  "messageId",
  "requestId",
]);

const WORD_ID = /^[a-z][a-z_-]{0,31}$/;

const CHOICE_FIELDS: ReadonlySet<string> = new Set(["value", "name"]);

type Scope = "configOptions" | "choices" | null;

const FIELD_NAME = /^[A-Za-z_][A-Za-z0-9_]{0,63}$/;

const OPAQUE_RUN = /\d{6,}|[0-9a-f]{16,}/i;

export interface TranscriptRedactor {
  redact(message: unknown): TranscriptJson;
}

export function createTranscriptRedactor(knownValues: readonly string[]): TranscriptRedactor {
  const known = usableKnownValues(knownValues);
  const pseudonyms = new Map<string, string>();
  const keys = new Map<string, string>();

  const pseudonym = (field: string, value: string): string => {
    const existing = pseudonyms.get(value);
    if (existing) return existing;
    const created = `${field}-${pseudonyms.size + 1}`;
    pseudonyms.set(value, created);
    return created;
  };

  const key = (name: string): string => {
    if (FIELD_NAME.test(name) && !OPAQUE_RUN.test(name) && !containsKnown(name, known) && redactText(name) === name) {
      return name;
    }
    const existing = keys.get(name);
    if (existing) return existing;
    const created = `key-${keys.size + 1}`;
    keys.set(name, created);
    return created;
  };

  const value = (field: string | null, input: unknown, scope: Scope): TranscriptJson => {
    if (typeof input === "string") {
      if (field !== null && ID_FIELDS.has(field)) {
        return WORD_ID.test(input) && !containsKnown(input, known) ? input : pseudonym(field, input);
      }
      const kept = field !== null && (KEPT_FIELDS.has(field) || (scope === "choices" && CHOICE_FIELDS.has(field)));
      if (kept && !containsKnown(input, known)) return redactText(input) === input ? input : REDACTED;
      return REDACTED;
    }
    if (Array.isArray(input)) return input.map((entry) => value(field, entry, scope));
    if (input !== null && typeof input === "object") {
      const output: TranscriptJsonObject = {};
      for (const [name, entry] of Object.entries(input)) {
        const inner: Scope =
          name === "configOptions" ? "configOptions" : name === "options" && scope !== null ? "choices" : null;
        const choice = CHOICE_FIELDS.has(name) && typeof entry === "string" ? scope : null;
        output[key(name)] = value(name, entry, inner ?? choice);
      }
      return output;
    }
    return typeof input === "number" || typeof input === "boolean" ? input : null;
  };

  return { redact: (message) => value(null, message, null) };
}

export function assertRedacted(line: string, knownValues: readonly string[]): void {
  if (containsKnown(line, usableKnownValues(knownValues))) {
    throw new Error("A transcript line still holds a value of this computer.");
  }
  if (strings(JSON.parse(line)).some((text) => redactText(text) !== text)) {
    throw new Error("A transcript line still holds a secret.");
  }
}

function strings(input: unknown): string[] {
  if (typeof input === "string") return [input];
  if (Array.isArray(input)) return input.flatMap(strings);
  if (input !== null && typeof input === "object") {
    return Object.entries(input).flatMap(([name, entry]) => [name, ...strings(entry)]);
  }
  return [];
}

function usableKnownValues(values: readonly string[]): readonly string[] {
  return values.map((entry) => entry.trim()).filter((entry) => entry.length >= 4);
}

function containsKnown(text: string, known: readonly string[]): boolean {
  const lower = text.toLowerCase();
  return known.some((entry) => lower.includes(entry.toLowerCase()));
}
