import { isDynamicRecord } from "@openbot/contracts/runtime-values";

// No import of `@openbot/logging` or the catalogs here: `@openbot/team-client` runs in a browser and
// in React Native, and builds references with this module only.

export const NETWORK_MESSAGE =
  /^(?:TypeError: )?(?:Failed to fetch|fetch failed|Network request failed|Load failed|NetworkError when attempting to fetch resource\.)$/iu;

/**
 * What Electron and the error classes put in front of a message: `Error invoking remote method
 * 'x': RemoteRequestError: …`. A built-in `TypeError:` and the like stays, because it marks runtime
 * output that is never shown.
 */
export const MESSAGE_PREFIX =
  /^(?:(?:Error invoking remote method '[^']+':|(?!(?:Type|Syntax|Reference|Range)Error:)(?:[A-Z]\w*)?Error(?:\[ref:[^\]\s]*\])?:)\s*)+/u;

export function normalizeMessage(error: unknown): string {
  const raw = error instanceof Error ? error.message : typeof error === "string" ? error : "";
  return raw.trim().replace(MESSAGE_PREFIX, "");
}

export function errnoCode(message: string): string | undefined {
  return message.match(/^(?:[a-z]+\s+)?(E[A-Z_]+)(?=[:\s]|$)/u)?.[1];
}

/**
 * A short code that says where a failure came from, such as `signal/host_busy`,
 * `http/403/session_inactive` or `errno/ECONNREFUSED`. A user can copy it into a report.
 *
 * A reference is built only from fixed identifiers: protocol codes, HTTP statuses, errno and SQLite
 * tokens, and error class names. Anything else fails this pattern, so a path, a URL, a token or a
 * sentence from a server can never become one.
 */
const REFERENCE = /^(?=.{3,64}$)[a-z][a-z0-9_-]{0,15}(?:\/[A-Za-z0-9_.-]{1,40}){1,3}$/u;
/** One part of a reference: no `/` or `:`, so a part cannot add levels or carry a URL. */
const REFERENCE_PART = /^[A-Za-z0-9_.-]{1,40}$/u;

/** The name the main process gives an error that crosses IPC, so its reference survives the trip. */
const REFERENCE_CARRIER = /(?:^|\s)(?:[A-Z]\w*)?Error\[ref:([^\]\s]{1,64})\]:/u;

/** `value` when it is a valid reference, otherwise null. */
export function safeReference(value: unknown): string | null {
  return typeof value === "string" && REFERENCE.test(value) ? value : null;
}

/** Join parts into a reference. An unsafe or empty part is left out. */
export function referenceFrom(...parts: readonly (string | number | null | undefined)[]): string | null {
  const safe = parts
    .map((part) => (typeof part === "number" ? String(part) : part))
    .filter((part): part is string => typeof part === "string" && REFERENCE_PART.test(part));
  return safe.length > 0 ? safeReference(safe.join("/")) : null;
}

/** The name an error must have to carry `reference` across Electron IPC. */
export function referenceCarrierName(reference: string): string {
  return `Error[ref:${reference}]`;
}

function stringField(error: unknown, name: "reference" | "code" | "_tag"): string | undefined {
  const value = isDynamicRecord(error) ? error[name] : undefined;
  return typeof value === "string" ? value : undefined;
}

function statusField(error: unknown): number | undefined {
  const value = isDynamicRecord(error) ? error.status : undefined;
  return typeof value === "number" && Number.isInteger(value) && value >= 100 && value <= 599 ? value : undefined;
}

function codeReference(code: string): string | null {
  if (/^SQLITE_[A-Z_]+$/u.test(code)) return referenceFrom("sqlite", code);
  if (/^(?:E[A-Z_]+|ERR_[A-Z_]+)$/u.test(code)) return referenceFrom("errno", code);
  return referenceFrom("code", code);
}

/**
 * The reference of a failure, or null when nothing safe identifies it. Read in order: an explicit
 * `reference` field, the IPC carrier, a typed `status` and `code`, a token in the message, a leading
 * HTTP status, the cause, and the error class.
 */
export function errorReference(error: unknown, depth = 0): string | null {
  const explicit = safeReference(stringField(error, "reference"));
  if (explicit) return explicit;
  const raw = error instanceof Error ? error.message : typeof error === "string" ? error : "";
  const carried = raw.match(REFERENCE_CARRIER)?.[1];
  if (carried && safeReference(carried)) return carried;

  const status = statusField(error);
  const code = stringField(error, "code");
  const typedCode = code !== undefined && REFERENCE_PART.test(code) ? code : null;
  if (status !== undefined) return referenceFrom("http", status, typedCode);
  if (typedCode) return codeReference(typedCode);

  const message = normalizeMessage(error);
  const token =
    errnoCode(message) ?? message.match(/\b(SQLITE_[A-Z_]+|ERR_[A-Z_]+|E(?:CONN|NOT|AI_|TIMEDOUT)[A-Z_]*)\b/u)?.[1];
  if (token) return codeReference(token);
  const httpStatus = message.match(/^(?:HTTP )?([1-5]\d\d)(?:\b|:)/u)?.[1];
  if (httpStatus) return referenceFrom("http", httpStatus);
  if (NETWORK_MESSAGE.test(message)) return "network/fetch";

  // A wrapper such as `RemoteWorkflowError` names the step; its cause names the failure.
  const cause = error instanceof Error ? error.cause : undefined;
  if (cause !== undefined && cause !== error && depth < 3) {
    const caused = errorReference(cause, depth + 1);
    if (caused) return caused;
  }
  const tag = stringField(error, "_tag");
  if (tag) return referenceFrom("error", tag);
  if (error instanceof Error && error.name !== "Error") return referenceFrom("error", error.name);
  return null;
}
