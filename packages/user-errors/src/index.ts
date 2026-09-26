import {
  localizeSourceText,
  type SourceMessages,
  sourceTranslateFor,
  type TranslatedLocale,
} from "@openbot/i18n/source";
import { redactText } from "@openbot/logging";

/**
 * What went wrong, in the terms a recovery affordance needs.
 *
 * The kind is decided once and the display copy is derived from it, so a screen that offers a "Sign
 * in" button and the sentence above that button can never disagree about whether the failure was an
 * authentication failure.
 */
export type UserErrorKind =
  | "auth"
  | "permission"
  | "file-permission"
  | "rate-limit"
  | "network"
  | "timeout"
  | "storage"
  | "not-found"
  | "read-only"
  | "conflict"
  | "service"
  | "unknown";

/** The catalog key for each kind's sentence. The text lives in `@openbot/i18n` (`error.kind.*`). */
const USER_ERROR_COPY = {
  network: "error.kind.network",
  timeout: "error.kind.timeout",
  storage: "error.kind.storage",
  "file-permission": "error.kind.filePermission",
  "not-found": "error.kind.notFound",
  "read-only": "error.kind.readOnly",
  conflict: "error.kind.conflict",
  auth: "error.kind.auth",
  permission: "error.kind.permission",
  "rate-limit": "error.kind.rateLimit",
  service: "error.kind.service",
} as const satisfies Record<Exclude<UserErrorKind, "unknown">, keyof SourceMessages>;

const NETWORK_CODES = [
  "ECONNREFUSED",
  "ECONNRESET",
  "ENOTFOUND",
  "EAI_AGAIN",
  "ERR_NETWORK",
  "ERR_INTERNET_DISCONNECTED",
];

const NETWORK_MESSAGE =
  /^(?:TypeError: )?(?:Failed to fetch|fetch failed|Network request failed|Load failed|NetworkError when attempting to fetch resource\.)$/iu;

/**
 * Authentication signals that appear inside a longer sentence rather than at its start.
 *
 * A provider reports an expired account by quoting the whole HTTP exchange, so the status code sits
 * in the middle: `failed to fetch codex rate limits: GET https://… failed: 401 Unauthorized; body={
 * "error": { "message": "Could not parse your authentication token…" } }`. The anchored status rules
 * below cannot see that, and without this set the whole exchange - URL, headers and body - was
 * printed to the user verbatim.
 *
 * Bare `401` is deliberately not a signal: it matches ports, byte counts and IDs. Every entry here
 * pairs the code with a word that only an authentication failure uses.
 */
const AUTH_SIGNALS =
  /\b401\s+unauthorized\b|\bhttp\s*401\b|"status"\s*:\s*401\b|\bunauthorized_unknown\b|could not parse your authentication token|please try signing in again|\binvalid_api_key\b|\bnot authenticated\b/iu;

/** Runtime output, stack traces, paths and serialized objects: never shown, whatever the kind. */
const TECHNICAL_OUTPUT =
  /(?:\bSQLITE_\w+|\bERR_\w+|^E[A-Z_]+:|^Command failed|^spawn |\n\s*at |\[object Object\]|^\s*[<{[]|\/(?:Users|home|tmp|private|var|etc|usr)\/|[A-Za-z]:\\)/u;

/**
 * What Electron and the error classes put in front of a message: `Error invoking remote method
 * 'x': RemoteRequestError: …`. A built-in `TypeError:` and the like stays, because it marks runtime
 * output that is never shown.
 */
const MESSAGE_PREFIX =
  /^(?:(?:Error invoking remote method '[^']+':|(?!(?:Type|Syntax|Reference|Range)Error:)(?:[A-Z]\w*)?Error:)\s*)+/u;

function normalizeMessage(error: unknown): string {
  const raw = error instanceof Error ? error.message : typeof error === "string" ? error : "";
  return raw.trim().replace(MESSAGE_PREFIX, "");
}

function errnoCode(message: string): string | undefined {
  return message.match(/^(?:[a-z]+\s+)?(E[A-Z_]+)(?=[:\s]|$)/u)?.[1];
}

/**
 * Decide what kind of failure this is. Use it to choose a recovery affordance; use
 * {@link userErrorMessage} for the sentence that goes with it.
 */
export function classifyUserError(error: unknown): UserErrorKind {
  const message = normalizeMessage(error);
  const code = errnoCode(message);

  if (NETWORK_MESSAGE.test(message) || NETWORK_CODES.includes(code ?? "")) return "network";
  if (
    code === "ETIMEDOUT" ||
    code === "ERR_CONNECTION_TIMED_OUT" ||
    (error instanceof Error && error.name === "TimeoutError")
  ) {
    return "timeout";
  }
  if (code === "ENOSPC") return "storage";
  if (code === "EACCES" || code === "EPERM") return "file-permission";
  if (code === "ENOENT") return "not-found";
  if (code === "EROFS") return "read-only";
  if (code === "EEXIST") return "conflict";
  if (/^(?:HTTP )?401(?:\b|:)/u.test(message)) return "auth";
  if (/^(?:HTTP )?403(?:\b|:)/u.test(message)) return "permission";
  if (/^(?:HTTP )?429(?:\b|:)/u.test(message)) return "rate-limit";
  if (/^(?:HTTP )?5\d\d(?:\b|:)/u.test(message)) return "service";
  // Unanchored, and last: a 429 body that happens to mention a token is still a rate limit.
  if (AUTH_SIGNALS.test(message)) return "auth";
  return "unknown";
}

/**
 * Format errors for display only. Keep the original error for logs and recovery decisions.
 *
 * `fallback` is already in the reader's language. A product message the sender wrote with
 * `sourceText` is translated into `locale`; any other message is shown as it is. Redaction runs on
 * the final text, so a secret inside a translated placeholder is still removed.
 */
export function userErrorMessage(error: unknown, fallback: string, locale: TranslatedLocale = "en"): string {
  const kind = classifyUserError(error);
  if (kind !== "unknown") return sourceTranslateFor(locale)(USER_ERROR_COPY[kind]);

  const message = normalizeMessage(error);
  // Preserve useful product validation messages, but do not display runtime output or paths.
  if (
    !message ||
    message.length > 400 ||
    /^(?:TypeError|SyntaxError|ReferenceError|RangeError):/u.test(message) ||
    error instanceof TypeError ||
    error instanceof SyntaxError ||
    error instanceof ReferenceError ||
    error instanceof RangeError ||
    TECHNICAL_OUTPUT.test(message)
  ) {
    return fallback;
  }
  return redactText(localizeSourceText(message, locale));
}
