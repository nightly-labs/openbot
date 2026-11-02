// Field-level redaction for recorded provider transcripts, which are committed to the repository.
//
// A JSON-RPC message from a provider CLI carries prompts, answers, file contents, paths, account
// details and sometimes tokens, in fields that change with each CLI version. A rule that removes
// known secrets would miss the next new field, so this keeps an allow-list instead: only the
// protocol fields below keep their string values. Every other string becomes `REDACTED`, and
// generated ids become stable pseudonyms, so a request and its answer still refer to the same
// session.
// Numbers, booleans and null stay: they are counts, flags and codes.
import { redactText } from "@openbot/logging";

export const REDACTED = "[redacted]";

/** A JSON value, as a transcript stores it. */
export type TranscriptJson = string | number | boolean | null | TranscriptJson[] | TranscriptJsonObject;
export interface TranscriptJsonObject {
  [key: string]: TranscriptJson;
}

/** Fields whose string values are protocol words or public model names, not user data. */
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

/** Fields whose values identify a session, a turn or a request, and must match across messages. */
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

/**
 * An id that is a protocol word, such as the `model` config option or the `build` mode. Generated
 * ids hold digits or capitals, so they get a pseudonym.
 */
const WORD_ID = /^[a-z][a-z_-]{0,31}$/;

/**
 * The fields of a choice in a session config option, `configOptions[].options[]`, also in a group of
 * choices. Their values are model ids and effort names, and a driver selects a model only when the
 * session lists it. The same field names elsewhere hold data, so they are redacted there.
 */
const CHOICE_FIELDS: ReadonlySet<string> = new Set(["value", "name"]);

/** Where a value is, for the choice fields above. */
type Scope = "configOptions" | "choices" | null;

/** A key that names a field. Any other key, such as a path or a server name, is data. */
const FIELD_NAME = /^[A-Za-z_][A-Za-z0-9_]{0,63}$/;

/** A run of digits or hex digits in a key, such as a token or an account number, is data. */
const OPAQUE_RUN = /\d{6,}|[0-9a-f]{16,}/i;

export interface TranscriptRedactor {
  /** Returns a redacted copy of one JSON-RPC message. */
  redact(message: unknown): TranscriptJson;
}

/**
 * Makes a redactor for one transcript. Pseudonyms are kept for its life, so the same session id
 * gets the same pseudonym in each message of the transcript.
 *
 * `knownValues` are the values of this computer that must never reach a transcript, such as the
 * home folder, the user name and the account email. A kept field that holds one is redacted too.
 */
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
        // A choice field keeps its scope only for a string: an object under it is not a choice.
        const choice = CHOICE_FIELDS.has(name) && typeof entry === "string" ? scope : null;
        output[key(name)] = value(name, entry, inner ?? choice);
      }
      return output;
    }
    return typeof input === "number" || typeof input === "boolean" ? input : null;
  };

  return { redact: (message) => value(null, message, null) };
}

/**
 * Throws when a JSON line still holds a known value, or a key or string that the log redaction
 * would mask.
 *
 * The recorder runs this on each line it writes, after the redactor, so a gap in the allow-list
 * stops the recording instead of reaching a commit. Each string is checked alone: the log
 * redaction of a whole JSON line also masks the numbers under keys such as `inputTokens`, which
 * are counts, not secrets.
 */
export function assertRedacted(line: string, knownValues: readonly string[]): void {
  if (containsKnown(line, usableKnownValues(knownValues))) {
    throw new Error("A transcript line still holds a value of this computer.");
  }
  if (strings(JSON.parse(line)).some((text) => redactText(text) !== text)) {
    throw new Error("A transcript line still holds a secret.");
  }
}

/** The keys and string values of a JSON value, at every depth. */
function strings(input: unknown): string[] {
  if (typeof input === "string") return [input];
  if (Array.isArray(input)) return input.flatMap(strings);
  if (input !== null && typeof input === "object") {
    return Object.entries(input).flatMap(([name, entry]) => [name, ...strings(entry)]);
  }
  return [];
}

/** Values too short to search for would match ordinary words. */
function usableKnownValues(values: readonly string[]): readonly string[] {
  return values.map((entry) => entry.trim()).filter((entry) => entry.length >= 4);
}

function containsKnown(text: string, known: readonly string[]): boolean {
  const lower = text.toLowerCase();
  return known.some((entry) => lower.includes(entry.toLowerCase()));
}
