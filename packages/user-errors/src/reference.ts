import { isDynamicRecord } from "@openbot/contracts/runtime-values";

export const NETWORK_MESSAGE =
  /^(?:TypeError: )?(?:Failed to fetch|fetch failed|Network request failed|Load failed|NetworkError when attempting to fetch resource\.)$/iu;

export const MESSAGE_PREFIX =
  /^(?:(?:Error invoking remote method '[^']+':|(?!(?:Type|Syntax|Reference|Range)Error:)(?:[A-Z]\w*)?Error(?:\[ref:[^\]\s]*\])?:)\s*)+/u;

export function normalizeMessage(error: unknown): string {
  const raw = error instanceof Error ? error.message : typeof error === "string" ? error : "";
  return raw.trim().replace(MESSAGE_PREFIX, "");
}

export function errnoCode(message: string): string | undefined {
  return message.match(/^(?:[a-z]+\s+)?(E[A-Z_]+)(?=[:\s]|$)/u)?.[1];
}

const REFERENCE = /^(?=.{3,64}$)[a-z][a-z0-9_-]{0,15}(?:\/[A-Za-z0-9_.-]{1,40}){1,3}$/u;
const REFERENCE_PART = /^[A-Za-z0-9_.-]{1,40}$/u;

const REFERENCE_CARRIER = /(?:^|\s)(?:[A-Z]\w*)?Error\[ref:([^\]\s]{1,64})\]:/u;

export function safeReference(value: unknown): string | null {
  return typeof value === "string" && REFERENCE.test(value) ? value : null;
}

export function referenceFrom(...parts: readonly (string | number | null | undefined)[]): string | null {
  const safe = parts
    .map((part) => (typeof part === "number" ? String(part) : part))
    .filter((part): part is string => typeof part === "string" && REFERENCE_PART.test(part));
  return safe.length > 0 ? safeReference(safe.join("/")) : null;
}

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
