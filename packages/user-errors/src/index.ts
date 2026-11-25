import {
  localizeSourceText,
  type SourceMessages,
  sourceTranslateFor,
  type TranslatedLocale,
} from "@openbot/i18n/source";
import { redactText } from "@openbot/logging";
import { errnoCode, errorReference, NETWORK_MESSAGE, normalizeMessage } from "./reference";

export { errorReference, referenceCarrierName, referenceFrom, safeReference } from "./reference";

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
  | "clock"
  | "interrupted"
  | "unknown";

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
  clock: "error.kind.clock",
  interrupted: "error.kind.interrupted",
} as const satisfies Record<Exclude<UserErrorKind, "unknown">, keyof SourceMessages>;

const NETWORK_CODES = [
  "ECONNREFUSED",
  "ECONNRESET",
  "ENOTFOUND",
  "EAI_AGAIN",
  "ERR_NETWORK",
  "ERR_INTERNET_DISCONNECTED",
];

const AUTH_SIGNALS =
  /\b401\s+unauthorized\b|\bunauthorized\s*\(\s*401\s*\)|\bhttp\s*401\b|"status"\s*:\s*401\b|\bunauthorized_unknown\b|could not parse your authentication token|please try signing in again|please log out and sign in again|\binvalid_api_key\b|\bnot authenticated\b/iu;

const RATE_LIMIT_SIGNALS = /\b429\s+too many requests\b|\blast status:\s*429\b|"status"\s*:\s*429\b/iu;

const CLOCK_SIGNALS = /\bCERT_NOT_YET_VALID\b|\bcertificate is not yet valid\b/iu;

const INTERRUPTED_ANSWER = /\bstream disconnected before completion\b/iu;
const CONTENT_FILTER_STOP = /\bcontent_filter\b/u;

const TECHNICAL_OUTPUT =
  /(?:\bSQLITE_\w+|\bERR_\w+|^E[A-Z_]+:|^Command failed|^spawn |\n\s*at |\[object Object\]|^\s*[<{[]|\/(?:Users|home|tmp|private|var|etc|usr)\/|[A-Za-z]:\\)/u;

export function classifyUserError(error: unknown): UserErrorKind {
  const message = normalizeMessage(error);
  const code = errnoCode(message);

  if (NETWORK_MESSAGE.test(message) || NETWORK_CODES.includes(code ?? "")) return "network";
  if (
    code === "ETIMEDOUT" ||
    code === "ERR_CONNECTION_TIMED_OUT" ||
    (error instanceof Error && error.name === "TimeoutError") ||
    errorReference(error) === "error/TimeoutError"
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
  if (RATE_LIMIT_SIGNALS.test(message)) return "rate-limit";
  if (CLOCK_SIGNALS.test(message)) return "clock";
  if (AUTH_SIGNALS.test(message)) return "auth";
  if (INTERRUPTED_ANSWER.test(message) && !CONTENT_FILTER_STOP.test(message)) return "interrupted";
  return "unknown";
}

export function userErrorMessage(error: unknown, fallback: string, locale: TranslatedLocale = "en"): string {
  const kind = classifyUserError(error);
  if (kind !== "unknown") return sourceTranslateFor(locale)(USER_ERROR_COPY[kind]);

  const message = normalizeMessage(error);
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

export interface UserErrorDetails {
  message: string;
  reference: string | null;
}

export function userErrorDetails(error: unknown, fallback: string, locale: TranslatedLocale = "en"): UserErrorDetails {
  return { message: userErrorMessage(error, fallback, locale), reference: errorReference(error) };
}
