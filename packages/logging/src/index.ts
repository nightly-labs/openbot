import { dummyLogger, type Logger } from "ts-log";

export { maskIdentifiers } from "./identifiers";
export type { Logger };
export { dummyLogger };

export type LogValue = string | number | boolean | bigint | null | undefined | LogValue[] | { [key: string]: LogValue };

export type LogLevel = "trace" | "debug" | "info" | "warn" | "error" | "silent";

const LEVEL_RANK: Record<LogLevel, number> = { trace: 10, debug: 20, info: 30, warn: 40, error: 50, silent: 60 };
const LOG_LEVELS: LogLevel[] = ["trace", "debug", "info", "warn", "error", "silent"];

const SECRET_LABEL = `[A-Za-z0-9_.-]{0,64}(?:password|passwd|passphrase|secret|token|credential|authorization|cookie|api[_-]?key|private[_-]?key|signing[_-]?key)[A-Za-z0-9_.-]{0,64}`;

const BEARER_SECRET = /Bearer\s+[A-Za-z0-9._~+/=-]{8,}/giu;
const AUTH_HEADER_SECRET = /(authorization["']?\s*[=:]+\s*)[A-Za-z][A-Za-z0-9_-]{0,31}\s+[A-Za-z0-9._~+/=-]{8,}/giu;
const CREDENTIAL_ASSIGNMENT = new RegExp(
  String.raw`(["']?(?:${SECRET_LABEL})["']?\s*[=:]+\s*)(\[redacted\]|"[^"]*"|'[^']*'|[^\s,;)}\]]+)`,
  "giu",
);
const KNOWN_SECRET_PREFIXES =
  /(?<![A-Za-z0-9_-])(?:(?:sk-ant|sk-|sk_|xai-|ghp_|gho_|ghu_|ghr_|ghs_|github_pat_|AKIA|xox[abeoprs]-|xapp-|glpat-|rk_live_|rk_test_)[A-Za-z0-9._-]{8,}|whsec_[A-Za-z0-9+/=._-]{8,}|AIza[A-Za-z0-9_-]{30,}|(?:npm|hf|gsk)_[A-Za-z0-9]{30,}|ASIA[A-Z0-9]{16}(?![A-Za-z0-9])|ya29\.[A-Za-z0-9_-]{20,}|GOCSPX-[A-Za-z0-9_-]{20,}|(?:bot)?\d{6,12}:[A-Za-z0-9_-]{35}(?![A-Za-z0-9_-]))/g;
const WEBHOOK_URL_SECRET =
  /(https:\/\/(?:hooks\.slack\.com\/(?:services|workflows|triggers)\/|(?:(?:canary|ptb)\.)?discord(?:app)?\.com\/api\/(?:v\d+\/)?webhooks\/))(?!\[redacted\])[^\s"'<>?#)\]]+/giu;
const JSON_WEB_TOKEN = /(?<![A-Za-z0-9_-])eyJ[A-Za-z0-9_-]{8,}\.eyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]*/g;
const PEM_PRIVATE_KEY =
  /-----BEGIN [A-Z0-9 ]{0,40}PRIVATE KEY-----(?:[\s\S]{0,16384}?-----END [A-Z0-9 ]{0,40}PRIVATE KEY-----|(?:\\[rn]|\s)*[A-Za-z0-9+/=]{16,}[\s\S]*$)/gu;
const COOKIE_HEADER =
  /(\bcookie["']?\s*:\s*["']?)[^\s=;,"'\\]{1,256}=(?:\\.|"[^"\r\n\\]{0,4096}"(?=;|[ \t]*(?:[\r\n]|$))|[^\r\n"'\\])*/giu;
const QUERY_SECRET = /([?&](?:key|code|ticket|sig)=)(?!\[redacted\])(?=[^&#\s"'<>)\]]{0,256}\d)[^&#\s"'<>)\]]{8,}/giu;
const URL_PASSWORD = /(\b[a-z][a-z0-9+.-]{0,31}:\/\/[^\s:/?#@[\]"'<>]{0,256}:)[^\s/?#@"'<>]{1,256}(?=@)/giu;
const EMAIL = /[A-Z0-9._%+-]{1,64}@[A-Z0-9.-]{1,255}\.[A-Z]{2,24}/giu;
const SECRET_KEY = new RegExp(`^(?:${SECRET_LABEL}|keys?)$`, "iu");

const JSON_BARE_KEY = /("keys?"\s*:\s*)(\[redacted\]|"[^"]*"|'[^']*'|[^\s,;)}\]]+)/giu;

const HEADER_KEY = /^headers$/iu;

const MAX_PARAM_LENGTH = 2_000;

const UNSERIALIZABLE = "[unserializable]";

const MIN_REGISTERED_SECRET_LENGTH = 8;
const RULE_WORD =
  /password|passwd|passphrase|secret|token|credential|authorization|cookie|api[_-]?key|private[_-]?key|signing[_-]?key|bearer|basic|digest|headers|keys?/iu;
const TOKEN_CHARACTER = /[A-Za-z0-9._~+/@%-]/u;
const URL_HOST = /(?<![A-Za-z0-9+.-])(https?:\/\/(?:[^\s/?#@]*@)?)([\p{L}\p{N}.-]+)/giu;
const VALUE_MARKER = "__openbot_registered_value__";
const LABEL_MARKER = "__openbot_registered_secret_authorization";
const MARKERS = new RegExp(`${VALUE_MARKER}|${LABEL_MARKER}`, "gu");
const registeredSecrets = new Set<string>();
let registeredSecretPattern: RegExp | null = null;
const publicValues = new Set<string>();

export function registerPublicValues(values: Iterable<string>): void {
  for (const value of values) if (value) publicValues.add(value);
}

function isPublicValueAround(candidate: string, secret: string): boolean {
  return candidate.length > secret.length && candidate.includes(secret) && publicValues.has(candidate);
}

function isPublicToken(token: string, secret: string): boolean {
  if (publicValues.size === 0) return false;
  if (isPublicValueAround(token, secret)) return true;
  return token.endsWith(".") && isPublicValueAround(token.replace(/\.+$/u, ""), secret);
}

export function registerSecretValue(value: string, options: { allowShort?: boolean } = {}): void {
  registerSecretValues([value], options);
}

export function registerSecretValues(values: Iterable<string>, options: { allowShort?: boolean } = {}): void {
  const size = registeredSecrets.size;
  for (const value of values) {
    if (!value || (!options.allowShort && value.length < MIN_REGISTERED_SECRET_LENGTH)) continue;
    for (const form of [value, JSON.stringify(value).slice(1, -1), uriEncoded(value)]) {
      if (form !== null) registeredSecrets.add(form);
    }
  }
  if (registeredSecrets.size === size) return;
  const alternatives = [...registeredSecrets]
    .sort((left, right) => right.length - left.length)
    .map((secret) => secret.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&"));
  registeredSecretPattern = new RegExp(alternatives.join("|"), "gu");
}

function uriEncoded(value: string): string | null {
  try {
    return encodeURIComponent(value);
  } catch {
    return null;
  }
}

export function isSecretName(name: string): boolean {
  return SECRET_KEY.test(name);
}

export function redactText(value: string): string {
  return redact(value, true);
}

export function redactSecrets(value: string): string {
  return redact(value, false, "keepPastScanBound");
}

export function containsSecret(value: string): boolean {
  return redact(value, true, "keep") !== value;
}

export function redactPostText(value: string): string {
  return maskWholeRegisteredSecrets(applyKeyFormatRules(value));
}

const POST_TOKEN_CHARACTER = /[\p{L}\p{N}._~+@%-]/u;
const POST_TOKEN_TAIL = /^[\p{L}\p{N}._~+@-]*/u;
const PERCENT_ESCAPE_BEFORE = /%[0-9A-Fa-f]{2}$/u;
const SENTENCE_DOTS = /^\.*$/u;

function maskWholeRegisteredSecrets(value: string): string {
  const pattern = registeredSecretPattern;
  if (!pattern) return value;
  return value.replace(pattern, (secret: string, offset: number) =>
    isWholeToken(value, offset, offset + secret.length) ? "[redacted]" : secret,
  );
}

function endsWithPercentEscape(value: string, end: number): boolean {
  return PERCENT_ESCAPE_BEFORE.test(value.slice(Math.max(0, end - 3), end));
}

function isLinkUser(value: string, start: number, end: number): boolean {
  return value.charAt(end) === "@" && value.slice(Math.max(0, start - 3), start) === "://";
}

function isWholeToken(value: string, start: number, end: number): boolean {
  if (isLinkUser(value, start, end)) return true;
  if (start > 0 && POST_TOKEN_CHARACTER.test(value.charAt(start - 1)) && !endsWithPercentEscape(value, start))
    return false;
  return SENTENCE_DOTS.test(POST_TOKEN_TAIL.exec(value.slice(end))?.[0] ?? "");
}

type UnscannedText = "drop" | "keepPastScanBound" | "keep";

function redact(value: string, emails: boolean, unscanned: UnscannedText = "drop"): string {
  const marked = markRegisteredSecrets(value);
  const redacted =
    redactSerializedJson(marked, emails) ?? applyTextRules(redactEmbeddedJson(marked, emails, unscanned), emails);
  return marked === value ? redacted : redacted.replace(MARKERS, "[redacted]");
}

function markRegisteredSecrets(value: string): string {
  const pattern = registeredSecretPattern;
  if (!pattern) return value;
  pattern.lastIndex = 0;
  const ranges: Array<{ start: number; end: number }> = [];
  let hosts: Uint8Array | null | undefined;
  for (let match = pattern.exec(value); match !== null; match = pattern.exec(value)) {
    let start = match.index;
    let end = start + match[0].length;
    if (hosts === undefined) hosts = value.includes("://") ? urlHosts(value) : null;
    if (hosts?.subarray(start, end).every((flag) => flag === HOST)) continue;
    const previous = ranges.at(-1);
    const floor = previous?.end ?? 0;
    while (start > floor && !hosts?.[start - 1] && TOKEN_CHARACTER.test(value.charAt(start - 1))) start -= 1;
    if (previous && end <= previous.end) continue;
    while (end < value.length && !hosts?.[end] && TOKEN_CHARACTER.test(value.charAt(end))) end += 1;
    if (isPublicToken(value.slice(start, end), match[0])) continue;
    if (previous && start <= previous.end) previous.end = end;
    else ranges.push({ start, end });
  }
  if (ranges.length === 0) return value;
  let result = "";
  let copied = 0;
  for (const { start, end } of ranges) {
    const token = value.slice(start, end);
    result += value.slice(copied, start) + (RULE_WORD.test(token) ? LABEL_MARKER : VALUE_MARKER);
    copied = end;
  }
  return result + value.slice(copied);
}

const HOST = 1;
const HOST_SEPARATOR = 2;

function urlHosts(value: string): Uint8Array {
  const flags = new Uint8Array(value.length);
  for (const match of value.matchAll(URL_HOST)) {
    const prefix = match[1] ?? "";
    const start = match.index + prefix.length;
    flags.fill(HOST, start, start + (match[2]?.length ?? 0));
    if (prefix.endsWith("@")) flags[start - 1] = HOST_SEPARATOR;
  }
  return flags;
}

function applyKeyFormatRules(value: string): string {
  return redactKeyFormatsAfterLabels(redactKeyFormatsBeforeLabels(value));
}

function redactKeyFormatsBeforeLabels(value: string): string {
  return value
    .replace(PEM_PRIVATE_KEY, "[redacted]")
    .replace(COOKIE_HEADER, "$1[redacted]")
    .replace(AUTH_HEADER_SECRET, "$1[redacted]")
    .replace(BEARER_SECRET, "[redacted]");
}

function redactKeyFormatsAfterLabels(value: string): string {
  return value
    .replace(URL_PASSWORD, "$1[redacted]")
    .replace(WEBHOOK_URL_SECRET, "$1[redacted]")
    .replace(KNOWN_SECRET_PREFIXES, "[redacted]")
    .replace(JSON_WEB_TOKEN, "[redacted]");
}

function applyTextRules(value: string, emails: boolean): string {
  const labeled = redactKeyFormatsBeforeLabels(value)
    .replace(CREDENTIAL_ASSIGNMENT, redactAssignedValue)
    .replace(JSON_BARE_KEY, redactAssignedValue)
    .replace(QUERY_SECRET, "$1[redacted]");
  const redacted = redactKeyFormatsAfterLabels(labeled);
  return emails ? redacted.replace(EMAIL, "[redacted-email]") : redacted;
}

const MAX_EMBEDDED_SCANS = 16;

const UNSCANNED = "[redacted-unscanned]";

const JSON_ONLY_SECRET_SHAPE = new RegExp(
  String.raw`"headers"\s*:|"(?:name|key)"\s*:\s*"(?:${SECRET_LABEL}|keys?)"`,
  "iu",
);

const JSON_ESCAPE = /\\(?:u([0-9A-Fa-f]{4})|(["\\/bfnrt]))/gu;

const JSON_ESCAPED_CHARACTERS: Record<string, string> = { b: "\b", f: "\f", n: "\n", r: "\r", t: "\t" };

function jsonUnescaped(text: string): string {
  return text.replace(JSON_ESCAPE, (_escape: string, code: string | undefined, character: string) =>
    code ? String.fromCharCode(Number.parseInt(code, 16)) : (JSON_ESCAPED_CHARACTERS[character] ?? character),
  );
}

function hidesSecret(text: string, emails: boolean): boolean {
  const decoded = jsonUnescaped(text);
  return JSON_ONLY_SECRET_SHAPE.test(decoded) || (decoded !== text && applyTextRules(decoded, emails) !== decoded);
}

function keptOrUnscanned(text: string, emails: boolean): string {
  return hidesSecret(text, emails) ? UNSCANNED : text;
}

function redactEmbeddedJson(value: string, emails: boolean, unscanned: UnscannedText): string {
  let result = "";
  let index = 0;
  let scans = 0;
  while (index < value.length) {
    const start = findPayloadStart(value, index);
    if (start < 0) break;
    if (scans >= MAX_EMBEDDED_SCANS) {
      if (unscanned === "keepPastScanBound") return result + value.slice(index);
      if (unscanned === "keep") return result + value.slice(index, start) + keptOrUnscanned(value.slice(start), emails);
      return `${result + value.slice(index, start)}${UNSCANNED}`;
    }
    scans += 1;
    const end = findBalancedEnd(value, start);
    if (end < 0 && startsLikeJson(value, start)) {
      if (unscanned !== "keep" || hidesSecret(value.slice(start), emails))
        return `${result + value.slice(index, start)}${UNSCANNED}`;
    }
    const parsed = end < 0 ? null : parseRedacted(value.slice(start, end), emails);
    if (parsed === null) {
      if (end >= 0 && startsLikeJson(value, start)) {
        result +=
          value.slice(index, start) +
          (unscanned === "keep" ? keptOrUnscanned(value.slice(start, end), emails) : UNSCANNED);
        index = end;
        continue;
      }
      let next = start + 1;
      while (value[next] === "{" || value[next] === "[") next += 1;
      result += value.slice(index, next);
      index = next;
      continue;
    }
    result += value.slice(index, start) + parsed;
    index = end;
  }
  return result + value.slice(index);
}

function parseRedacted(candidate: string, emails: boolean): string | null {
  try {
    const parsed = JSON.parse(candidate);
    const converted = convertValue(parsed, new Set<object>(), { emails, unscanned: "drop" });
    if (unchangedKeyCount(parsed, converted) === writtenKeyCount(candidate)) return candidate;
    return JSON.stringify(converted) ?? null;
  } catch {
    return null;
  }
}

function unchangedKeyCount(parsed: unknown, converted: unknown): number {
  if (parsed === null || typeof parsed !== "object") return parsed === converted ? 0 : -1;
  if (converted === null || typeof converted !== "object" || Array.isArray(parsed) !== Array.isArray(converted))
    return -1;
  const entries = Object.entries(parsed);
  const convertedEntries = Object.entries(converted);
  if (entries.length !== convertedEntries.length) return -1;
  let count = Array.isArray(parsed) ? 0 : entries.length;
  for (const [index, [key, value]] of entries.entries()) {
    const [convertedKey, convertedValue] = convertedEntries[index] ?? [];
    const inner = key === convertedKey ? unchangedKeyCount(value, convertedValue) : -1;
    if (inner < 0) return -1;
    count += inner;
  }
  return count;
}

function writtenKeyCount(text: string) {
  let count = 0;
  for (let index = 0; index < text.length; index += 1) {
    if (text[index] !== '"') continue;
    index += 1;
    while (index < text.length && text[index] !== '"') index += text[index] === "\\" ? 2 : 1;
    let next = index + 1;
    while (text[next] === " " || text[next] === "\t" || text[next] === "\n" || text[next] === "\r") next += 1;
    if (text[next] === ":") count += 1;
  }
  return count;
}

function startsLikeJson(value: string, start: number): boolean {
  for (let index = start + 1; index < value.length; index += 1) {
    const char = value[index];
    if (char === " " || char === "\t" || char === "\n" || char === "\r" || char === "{" || char === "[") continue;
    return char === '"';
  }
  return false;
}

function findPayloadStart(value: string, from: number): number {
  for (let index = from; index < value.length; index += 1) {
    const char = value[index];
    if (char === "{" || char === "[") return index;
  }
  return -1;
}

function findBalancedEnd(value: string, start: number): number {
  let depth = 0;
  let inString = false;
  let escaped = false;
  for (let index = start; index < value.length; index += 1) {
    const char = value[index];
    if (inString) {
      if (escaped) escaped = false;
      else if (char === "\\") escaped = true;
      else if (char === '"') inString = false;
      continue;
    }
    if (char === '"') inString = true;
    else if (char === "{" || char === "[") depth += 1;
    else if (char === "}" || char === "]") {
      depth -= 1;
      if (depth === 0) return index + 1;
      if (depth < 0) return -1;
    }
  }
  return -1;
}

function redactAssignedValue(_match: string, label: string, value: string): string {
  const quote = value.startsWith('"') ? '"' : value.startsWith("'") ? "'" : "";
  return `${label}${quote}[redacted]${quote}`;
}

function redactSerializedJson(value: string, emails: boolean): string | null {
  const trimmed = value.trim();
  if (!trimmed.startsWith("{") && !trimmed.startsWith("[")) return null;
  return parseRedacted(trimmed, emails);
}

export function redactValue(value: LogValue): LogValue {
  return convertSafely(value);
}

export function toLogValue(value: unknown): LogValue {
  return convertSafely(value);
}

export function toSecretSafeValue(value: unknown): LogValue {
  return convertSafely(value, CHAT_RULES);
}

interface ConversionRules {
  emails: boolean;
  unscanned: UnscannedText;
}

const LOG_RULES: ConversionRules = { emails: true, unscanned: "drop" };
const CHAT_RULES: ConversionRules = { emails: false, unscanned: "keep" };

function convertSafely<T>(value: T, rules = LOG_RULES): LogValue {
  try {
    return convertValue(value, new Set<object>(), rules);
  } catch {
    return UNSERIALIZABLE;
  }
}

const MAX_CONVERSION_DEPTH = 32;

function convertValue<T>(value: T, seen: Set<object>, rules: ConversionRules, depth = 0): LogValue {
  const text = (input: string) => redact(input, rules.emails, rules.unscanned);
  if (typeof value === "string") return text(value);
  if (value === null) return null;
  if (value === undefined) return undefined;
  if (typeof value === "number" || typeof value === "boolean") return value;
  if (typeof value === "bigint") return `${value.toString()}n`;
  if (value instanceof Error) {
    const converted: { [key: string]: LogValue } = {
      name: text(value.name),
      message: text(value.message),
    };
    if (typeof value.stack === "string") converted.stack = text(value.stack);
    return converted;
  }
  if (Array.isArray(value)) {
    if (seen.has(value)) return "[circular]";
    if (depth >= MAX_CONVERSION_DEPTH) return "[too deep]";
    seen.add(value);
    return value.map((entry: LogValue) => convertValue(entry, seen, rules, depth + 1));
  }
  if (typeof value === "object") {
    if (seen.has(value)) return "[circular]";
    if (depth >= MAX_CONVERSION_DEPTH) return "[too deep]";
    seen.add(value);
    let entries: [string, unknown][];
    try {
      entries = Object.entries(value);
    } catch {
      return UNSERIALIZABLE;
    }
    const secretPair = entries.some(
      ([key, entry]) => (key === "name" || key === "key") && typeof entry === "string" && SECRET_KEY.test(entry),
    );
    return Object.fromEntries(
      entries.map(([key, entry]): [string, LogValue] => [
        text(key),
        secretPair && key === "value" ? "[redacted]" : convertEntry(key, entry, seen, rules, depth),
      ]),
    );
  }
  try {
    return text(String(value));
  } catch {
    return UNSERIALIZABLE;
  }
}

function convertEntry(key: string, entry: unknown, seen: Set<object>, rules: ConversionRules, depth: number): LogValue {
  if (SECRET_KEY.test(key)) return "[redacted]";
  const converted = convertValue(entry, seen, rules, depth + 1);
  if (!HEADER_KEY.test(key) || entry === null || typeof entry !== "object") return converted;
  return redactHeaderStrings(converted);
}

function redactHeaderStrings(value: LogValue): LogValue {
  if (typeof value === "string") return "[redacted]";
  if (Array.isArray(value)) return value.map(redactHeaderStrings);
  if (value !== null && typeof value === "object") {
    return Object.fromEntries(Object.entries(value).map(([key, entry]) => [key, redactHeaderStrings(entry)]));
  }
  return value;
}

function formatParam(param: LogValue): string {
  if (typeof param === "string") {
    const redacted = redactText(param);
    return redacted.length > MAX_PARAM_LENGTH ? `${redacted.slice(0, MAX_PARAM_LENGTH)}…` : redacted;
  }
  const serialized = JSON.stringify(redactValue(param)) ?? String(param);
  return serialized.length > MAX_PARAM_LENGTH ? `${serialized.slice(0, MAX_PARAM_LENGTH)}…` : serialized;
}

function formatLine(level: string, prefix: string, message: LogValue, params: LogValue[]): string {
  const head = typeof message === "string" ? redactText(message) : formatParam(message);
  const tail = params.map((param) => formatParam(param)).join(" ");
  return `${new Date().toISOString()} ${level} [${prefix}]${head ? ` ${head}` : ""}${tail ? ` ${tail}` : ""}`;
}

export function resolveLogLevel(raw: string | undefined, fallback: LogLevel = "info"): LogLevel {
  for (const level of LOG_LEVELS) {
    if (level === raw) return level;
  }
  return fallback;
}

const tees = new Set<{ prefixes: ReadonlySet<string>; sink: (line: string) => void }>();

export function teeLogLines(prefixes: readonly string[], sink: (line: string) => void): () => void {
  const tee = { prefixes: new Set(prefixes), sink };
  tees.add(tee);
  return () => {
    tees.delete(tee);
  };
}

function writeTees(prefix: string, line: string): void {
  for (const tee of tees) {
    if (!tee.prefixes.has(prefix)) continue;
    try {
      tee.sink(line);
    } catch {}
  }
}

export function createOpenBotLogger(prefix: string, sink?: (line: string) => void, level?: LogLevel): Logger {
  const threshold = LEVEL_RANK[level ?? resolveLogLevel(process.env.OPENBOT_LOG_LEVEL)];
  const out = sink ?? ((line: string) => process.stdout.write(`${line}\n`));
  const err = sink ?? ((line: string) => process.stderr.write(`${line}\n`));
  const write = (
    logLevel: LogLevel,
    label: string,
    stream: (line: string) => void,
  ): ((message?: LogValue, ...params: LogValue[]) => void) => {
    if (LEVEL_RANK[logLevel] < threshold) return () => undefined;
    return (message?: LogValue, ...params: LogValue[]) => {
      const line = formatLine(label, prefix, message, params);
      stream(line);
      writeTees(prefix, line);
    };
  };
  return {
    trace: write("trace", "TRACE", out),
    debug: write("debug", "DEBUG", out),
    info: write("info", "INFO", out),
    warn: write("warn", "WARN", err),
    error: write("error", "ERROR", err),
  };
}
