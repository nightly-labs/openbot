import { redactText } from "@openbot/logging";

export type SupportLogLevel = "info" | "warn" | "error";
export type SupportLogSource = "app" | "network" | "connection" | "console";

export interface SupportLogEntry {
  /** Unique in this launch, for list keys. A restored entry gets a new one. */
  id: number;
  time: number;
  level: SupportLogLevel;
  source: SupportLogSource;
  message: string;
}

/**
 * About three hours of use with a connected server, whose requests are most of the lines. 1,000 held
 * about 40 minutes: not enough for a problem that a user reports after the next return to the app.
 * The cache file is about 1 MB. A write appends the new entries; after 2,500 appended entries, and
 * after an app update, one write replaces the file with the kept entries.
 */
const MAX_ENTRIES = 5_000;
/** The cache file is written again with only the kept entries after it has this many entry lines. */
export const SUPPORT_LOG_CACHE_LINES = MAX_ENTRIES + MAX_ENTRIES / 2;
const MAX_MESSAGE_LENGTH = 600;
const LEVELS: readonly SupportLogLevel[] = ["info", "warn", "error"];
const SOURCES: readonly SupportLogSource[] = ["app", "network", "connection", "console"];

/**
 * Every message goes through the shared log redaction before it is kept. The screen, the cache file
 * and the saved file then mask tokens, keys and email addresses as the desktop logs do.
 */
function supportLogMessage(text: string): string {
  // Redaction reads the whole text. Only the start of a large payload can reach the kept length.
  const line = redactText(text.slice(0, MAX_MESSAGE_LENGTH * 8))
    .replace(/[\r\n]+\s*/gu, " | ")
    .replace(/\p{Cc}/gu, " ");
  return line.length > MAX_MESSAGE_LENGTH ? `${line.slice(0, MAX_MESSAGE_LENGTH)}…` : line;
}

/** The origin and path of a request. A query, a fragment or user info can hold a credential. */
export function supportLogUrl(url: string): string {
  return url.replace(/[?#].*$/su, "").replace(/^([a-z][a-z0-9+.-]*:\/\/)[^/@]*@/iu, "$1");
}

/** Text from any thrown value or console argument, without reading more than its message. */
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

type StoredEntry = Omit<SupportLogEntry, "id">;

/** One stored entry, or null when the value is not one. `redact` runs the shared redaction again. */
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

/**
 * The cache file of version 2: a header line with the key of the redaction that wrote the entries,
 * then one JSON line for each entry. A new entry is appended, so a write does not copy the log.
 */
export function supportLogCacheText(redaction: string | null, entries: readonly SupportLogEntry[]): string {
  return `${JSON.stringify({ redaction })}\n${supportLogCacheLines(entries)}`;
}

/** The lines that append these entries to a cache file of version 2. */
export function supportLogCacheLines(entries: readonly SupportLogEntry[]): string {
  return entries.map(storedLine).join("");
}

/**
 * Entries read back from a cache file of version 2. Each entry was redacted when it was added, and the
 * same redaction gives the same text again. So the redaction runs again only when `redaction` is not
 * the key in the file, such as after an app update, which can change the rules. A null key always
 * redacts. A damaged line, such as the last one after a crash in a write, is skipped.
 * `rewrite` is true when the file must be written again before the next append: its key is old, or
 * a damaged line would join the next one.
 */
export function parseSupportLogCache(
  text: string,
  redaction: string | null,
): { entries: StoredEntry[]; lines: number; rewrite: boolean } {
  const lines = text.split("\n");
  // The text after the last line break is empty in a complete file.
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

/** Entries read back from a cache file of version 1, a JSON array. A damaged file gives no entries, not an error. */
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

/**
 * Listeners hear changes after the current task. A console error that React writes while it
 * renders must not update the Support screen during that render.
 */
export function createSupportLog(
  now: () => number = Date.now,
  defer: (run: () => void) => void = (run) => void setTimeout(run, 0),
) {
  // New entries go to the end of `kept`, which drops its oldest entries only after it passes the
  // limit by a quarter. So one request costs no copy of the whole log.
  let kept: SupportLogEntry[] = [];
  // The first `saved` entries of `kept` are in the cache file. New entries go to the end, and restored
  // entries, which come from the file, go to the start, so the saved entries are always the first ones.
  let saved = 0;
  const keep = (entries: SupportLogEntry[]) => {
    const dropped = Math.max(0, entries.length - MAX_ENTRIES);
    saved = Math.max(0, saved - dropped);
    kept = entries.slice(dropped);
  };
  // Readers get the same array until the log changes, as `useSyncExternalStore` needs.
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
    /**
     * Puts entries from an earlier launch before the ones this launch already added. They come from
     * the cache file, so they count as saved: the caller restores before its first write.
     */
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
    /** The entries that are not in the cache file yet, oldest first. */
    unsaved: (): readonly SupportLogEntry[] => kept.slice(saved),
    /** All entries are in the cache file now. */
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

/**
 * The support log of this phone. It stays in memory and in the app cache, which the system does not
 * back up. Only the user moves it off the phone, from Settings > Support.
 */
export const supportLog = createSupportLog();

type RequestInput = string | URL | { readonly url: string; readonly method: string };

/** Method, origin, path, status and time of each request. Never a query, a header or a body. */
export function withRequestLog<
  I extends RequestInput,
  N extends { method?: string },
  R extends { ok: boolean; status: number },
>(original: (input: I, init?: N) => Promise<R>): (input: I, init?: N) => Promise<R> {
  return async (input, init) => {
    // TypeScript does not narrow a generic parameter, so read the value as its constraint.
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
