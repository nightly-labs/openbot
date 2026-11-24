import { maskIdentifiers, redactText } from "@openbot/logging";

export type SupportLogLevel = "info" | "warn" | "error";
export type SupportLogSource = "app" | "network" | "connection" | "console";

export interface SupportLogEntry {
  id: number;
  time: number;
  level: SupportLogLevel;
  source: SupportLogSource;
  message: string;
}

const MAX_ENTRIES = 5_000;
export const SUPPORT_LOG_CACHE_LINES = MAX_ENTRIES + MAX_ENTRIES / 2;
const MAX_MESSAGE_LENGTH = 600;
const LEVELS: readonly SupportLogLevel[] = ["info", "warn", "error"];
const SOURCES: readonly SupportLogSource[] = ["app", "network", "connection", "console"];

function supportLogMessage(text: string): string {
  const line = redactText(text.slice(0, MAX_MESSAGE_LENGTH * 8))
    .replace(/[\r\n]+\s*/gu, " | ")
    .replace(/\p{Cc}/gu, " ");
  return line.length > MAX_MESSAGE_LENGTH ? `${line.slice(0, MAX_MESSAGE_LENGTH)}…` : line;
}

export function supportLogUrl(url: string): string {
  return url.replace(/[?#].*$/su, "").replace(/^([a-z][a-z0-9+.-]*:\/\/)[^/@]*@/iu, "$1");
}

export function supportLogValue(value: unknown): string {
  if (value instanceof Error) return `${value.name}: ${value.message}`;
  if (typeof value === "string") return value;
  if (value === undefined || typeof value === "function" || typeof value === "symbol") return String(value);
  try {
    return JSON.stringify(value) ?? String(value);
  } catch {
    return "[unserializable]";
  }
}

export function formatSupportLogEntry(entry: SupportLogEntry): string {
  return `${new Date(entry.time).toISOString()} ${entry.level.toUpperCase().padEnd(5)} ${entry.source.padEnd(10)} ${entry.message}`;
}

const EXCERPT_LINES = 60;

const REQUEST_LINE = /^(?:\S+ |unknown server )?(?:GET|POST|PUT|PATCH|DELETE|HEAD|OPTIONS) \S+ -> /u;
const SERVER_ID_LENGTH = 8;

function serverNames(entries: readonly SupportLogEntry[]): Map<string, string> {
  const names = new Map<string, string>();
  for (const entry of entries) {
    if (entry.source !== "connection") continue;
    const id = /^(\S+) /u.exec(entry.message)?.[1];
    if (id && id !== "unknown" && !names.has(id)) names.set(id, `server-${names.size + 1}`);
  }
  return names;
}

function publicMessage(message: string, servers: ReadonlyMap<string, string>): string {
  let text = message;
  for (const [id, name] of servers) {
    if (text.startsWith(`${id} `)) text = `${name}${text.slice(id.length)}`;
    if (id.length >= SERVER_ID_LENGTH) text = text.replaceAll(id, name);
  }
  return maskIdentifiers(text.replace(/, capabilities: .*$/u, ""));
}

export function supportLogExcerpt(entries: readonly SupportLogEntry[], maxLength: number): string {
  const taken: SupportLogEntry[] = [];
  for (let index = entries.length - 1; index >= 0 && taken.length < EXCERPT_LINES; index -= 1) {
    const entry = entries[index];
    if (!entry || entry.source === "console") continue;
    const event = entry.source === "connection" || entry.source === "app";
    if (entry.level === "info" && (!event || REQUEST_LINE.test(entry.message))) continue;
    taken.push(entry);
  }
  taken.reverse();
  const servers = serverNames(taken);
  const lines = taken.map((entry) =>
    formatSupportLogEntry({ ...entry, message: publicMessage(entry.message, servers) }),
  );
  let length = lines.reduce((sum, line) => sum + line.length + 1, 0);
  while (length > maxLength) length -= (lines.shift()?.length ?? 0) + 1;
  return lines.join("\n");
}

type StoredEntry = Omit<SupportLogEntry, "id">;

function decodeStoredEntry(item: unknown, redact: boolean): StoredEntry | null {
  if (typeof item !== "object" || item === null) return null;
  const time = "time" in item ? item.time : undefined;
  const level = LEVELS.find((candidate) => "level" in item && item.level === candidate);
  const source = SOURCES.find((candidate) => "source" in item && item.source === candidate);
  const message = "message" in item ? item.message : undefined;
  if (typeof time !== "number" || !level || !source || typeof message !== "string") return null;
  return { time, level, source, message: redact ? supportLogMessage(message) : message };
}

function storedLine(entry: SupportLogEntry): string {
  return `${JSON.stringify({ time: entry.time, level: entry.level, source: entry.source, message: entry.message })}\n`;
}

export function supportLogCacheText(redaction: string | null, entries: readonly SupportLogEntry[]): string {
  return `${JSON.stringify({ redaction })}\n${supportLogCacheLines(entries)}`;
}

export function supportLogCacheLines(entries: readonly SupportLogEntry[]): string {
  return entries.map(storedLine).join("");
}

export function parseSupportLogCache(
  text: string,
  redaction: string | null,
): { entries: StoredEntry[]; lines: number; rewrite: boolean } {
  const lines = text.split("\n");
  const last = lines.pop();
  let header: unknown;
  try {
    header = JSON.parse(lines[0] ?? "");
  } catch {
    header = null;
  }
  const key =
    typeof header === "object" && header !== null && "redaction" in header && typeof header.redaction === "string"
      ? header.redaction
      : null;
  const redact = redaction === null || key !== redaction;
  const entries = lines.slice(1).flatMap((line) => {
    try {
      const entry = decodeStoredEntry(JSON.parse(line), redact);
      return entry ? [entry] : [];
    } catch {
      return [];
    }
  });
  return { entries, lines: Math.max(0, lines.length - 1), rewrite: redact || last !== "" };
}

export function parseSupportLog(text: string): StoredEntry[] {
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch {
    return [];
  }
  if (!Array.isArray(value)) return [];
  return value.flatMap((item: unknown) => {
    const entry = decodeStoredEntry(item, true);
    return entry ? [entry] : [];
  });
}

export function createSupportLog(
  now: () => number = Date.now,
  defer: (run: () => void) => void = (run) => void setTimeout(run, 0),
) {
  let kept: SupportLogEntry[] = [];
  let saved = 0;
  const keep = (entries: SupportLogEntry[]) => {
    const dropped = Math.max(0, entries.length - MAX_ENTRIES);
    saved = Math.max(0, saved - dropped);
    kept = entries.slice(dropped);
  };
  let snapshot: readonly SupportLogEntry[] | null = [];
  const listeners = new Set<() => void>();
  let pending = false;
  let nextId = 0;
  const notify = () => {
    snapshot = null;
    if (pending) return;
    pending = true;
    defer(() => {
      pending = false;
      for (const listener of listeners) listener();
    });
  };
  return {
    add(level: SupportLogLevel, source: SupportLogSource, text: string): void {
      kept.push({ id: nextId++, time: now(), level, source, message: supportLogMessage(text) });
      if (kept.length > MAX_ENTRIES + MAX_ENTRIES / 4) keep(kept);
      notify();
    },
    restore(previous: StoredEntry[]): void {
      const restored = previous.map((entry) => ({ ...entry, id: nextId++ }));
      saved = restored.length;
      keep([...restored, ...kept]);
      notify();
    },
    clear(): void {
      kept = [];
      saved = 0;
      notify();
    },
    unsaved: (): readonly SupportLogEntry[] => kept.slice(saved),
    markSaved(): void {
      saved = kept.length;
    },
    entries: (): readonly SupportLogEntry[] => {
      snapshot ??= kept.slice(-MAX_ENTRIES);
      return snapshot;
    },
    subscribe(listener: () => void): () => void {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
}

export const supportLog = createSupportLog();

type RequestInput = string | URL | { readonly url: string; readonly method: string };

export function withRequestLog<
  I extends RequestInput,
  N extends { method?: string },
  R extends { ok: boolean; status: number },
>(original: (input: I, init?: N) => Promise<R>): (input: I, init?: N) => Promise<R> {
  return async (input, init) => {
    const target: RequestInput = input;
    const request = typeof target === "object" && "method" in target ? target : null;
    const method = (init?.method ?? request?.method ?? "GET").toUpperCase();
    const url = supportLogUrl(typeof target === "string" ? target : "href" in target ? target.href : target.url);
    const started = Date.now();
    try {
      const response = await original(input, init);
      supportLog.add(
        response.ok ? "info" : "warn",
        "network",
        `${method} ${url} -> ${response.status} (${Date.now() - started} ms)`,
      );
      return response;
    } catch (error) {
      const canceled = error instanceof Error && error.name === "AbortError";
      supportLog.add(
        canceled ? "info" : "warn",
        "network",
        `${method} ${url} -> ${canceled ? "canceled" : `failed: ${supportLogValue(error)}`} (${Date.now() - started} ms)`,
      );
      throw error;
    }
  };
}
