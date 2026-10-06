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

/** Enough for several connection attempts and their requests, and still a small file. */
const MAX_ENTRIES = 1_000;
const MAX_MESSAGE_LENGTH = 600;
const LEVELS: readonly SupportLogLevel[] = ["info", "warn", "error"];
const SOURCES: readonly SupportLogSource[] = ["app", "network", "connection", "console"];

/**
 * Every message goes through the shared log redaction before it is kept. The screen, the cache file
 * and the saved file then mask tokens, keys and email addresses as the desktop logs do.
 */
export function supportLogMessage(text: string): string {
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

/** Entries read back from the cache file. A damaged file gives no entries, not an error. */
export function parseSupportLog(text: string): Omit<SupportLogEntry, "id">[] {
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch {
    return [];
  }
  if (!Array.isArray(value)) return [];
  return value.flatMap((item: unknown): Omit<SupportLogEntry, "id">[] => {
    if (typeof item !== "object" || item === null) return [];
    const time = "time" in item ? item.time : undefined;
    const level = LEVELS.find((candidate) => "level" in item && item.level === candidate);
    const source = SOURCES.find((candidate) => "source" in item && item.source === candidate);
    const message = "message" in item ? item.message : undefined;
    if (typeof time !== "number" || !level || !source || typeof message !== "string") return [];
    return [{ time, level, source, message: supportLogMessage(message) }];
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
  let entries: readonly SupportLogEntry[] = [];
  const listeners = new Set<() => void>();
  let pending = false;
  let nextId = 0;
  const notify = () => {
    if (pending) return;
    pending = true;
    defer(() => {
      pending = false;
      for (const listener of listeners) listener();
    });
  };
  return {
    add(level: SupportLogLevel, source: SupportLogSource, text: string): void {
      const entry = { id: nextId++, time: now(), level, source, message: supportLogMessage(text) };
      entries = [...entries.slice(-(MAX_ENTRIES - 1)), entry];
      notify();
    },
    /** Puts entries from an earlier launch before the ones this launch already added. */
    restore(previous: Omit<SupportLogEntry, "id">[]): void {
      const restored = previous.map((entry) => ({ ...entry, id: nextId++ }));
      entries = [...restored, ...entries].slice(-MAX_ENTRIES);
      notify();
    },
    clear(): void {
      entries = [];
      notify();
    },
    entries: () => entries,
    subscribe(listener: () => void): () => void {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
}

export type SupportLog = ReturnType<typeof createSupportLog>;
