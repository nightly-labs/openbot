import { createHash } from "node:crypto";
import { appendFile, mkdir, readdir, rename, rm, stat } from "node:fs/promises";
import { dirname, join } from "node:path";
import { type DiagnosticRecord, type LogValue, redactDiagnostic, redactText } from "@openbot/logging";

/**
 * The disk bound for the local diagnostics trail. Three files of 512 KiB is
 * about 3000 records - months of an app kept open for weeks - and it is a hard
 * ceiling rather than a target, because the failure this log exists to catch is
 * also the failure most likely to arrive in a retry loop.
 */
export const DEFAULT_MAX_FILE_BYTES = 512 * 1024;
export const DEFAULT_RETAINED_GENERATIONS = 2;
export const DEFAULT_MAX_LINE_BYTES = 4 * 1024;
export const DEFAULT_DEDUPE_WINDOW_MS = 60_000;
export const DEFAULT_RATE_LIMIT = { capacity: 120, refillPerSecond: 1 } as const;
/** The startup sweep is a backstop for drift, so it sits above the steady state rather than at it. */
export const DEFAULT_MAX_TREE_BYTES = 8 * 1024 * 1024;
export const DEFAULT_MAX_FILE_AGE_MS = 14 * 24 * 60 * 60 * 1000;
/** Enough fingerprints for a wide burst, bounded so a unique-per-record flood cannot grow the map. */
const MAX_TRACKED_FINGERPRINTS = 500;
/** The `detail` keys that identify *which* failure this is. `durationMs` is deliberately absent: it differs every time. */
const FINGERPRINT_KEYS = ["provider", "path", "errno", "exitCode", "step", "errorCode", "agentId", "attempts"];

export interface DiagnosticsLogOptions {
  directory: string;
  fileName?: string;
  maxFileBytes?: number;
  retainedGenerations?: number;
  maxLineBytes?: number;
  dedupeWindowMs?: number;
  rateLimit?: { capacity: number; refillPerSecond: number };
  now?: () => number;
  homeDirectory?: string;
  userDataDirectory?: string;
  /** The tree the startup sweep walks. Defaults to the parent of `directory`, which is the whole `logs` tree. */
  sweepDirectory?: string;
  maxTreeBytes?: number;
  maxFileAgeMs?: number;
}

/** How much of one process chunk is kept. The chunk is a remote process's own output, not a record. */
export const DEFAULT_MAX_TEXT_BYTES = 8_000;

export interface DiagnosticsLog {
  append(record: DiagnosticRecord): void;
  flush(): Promise<void>;
  prune(): Promise<void>;
}

interface DedupeEntry {
  openedAt: number;
  suppressed: number;
  code: string;
  area?: string;
  stage?: string;
}

/**
 * A bounded, append-only JSON-line trail of failures.
 *
 * It takes no `electron` import on purpose: the directory, the home directory
 * and the clock all arrive as options, so the test needs no module mock and the
 * writer stays usable from any process.
 */
export function createDiagnosticsLog(options: DiagnosticsLogOptions): DiagnosticsLog {
  const now = options.now ?? Date.now;
  const maxFileBytes = options.maxFileBytes ?? DEFAULT_MAX_FILE_BYTES;
  const retained = options.retainedGenerations ?? DEFAULT_RETAINED_GENERATIONS;
  const maxLineBytes = Math.min(options.maxLineBytes ?? DEFAULT_MAX_LINE_BYTES, maxFileBytes);
  const dedupeWindowMs = options.dedupeWindowMs ?? DEFAULT_DEDUPE_WINDOW_MS;
  const rateLimit = options.rateLimit ?? DEFAULT_RATE_LIMIT;
  const path = join(options.directory, options.fileName ?? "diagnostics.log");
  // Redaction has already abbreviated a standard home directory to `~` by the
  // time a record reaches here, so the user-data path is matched in both
  // spellings - `/Users/ada/Library/OpenBot` and `~/Library/OpenBot` - or the
  // longer, more specific replacement would never fire. The most specific
  // prefix goes first for the same reason.
  const abbreviations: [string, string][] = [
    ...uniquePrefixes(options.userDataDirectory).map((prefix): [string, string] => [prefix, "<userData>"]),
    ...uniquePrefixes(options.homeDirectory).map((prefix): [string, string] => [prefix, "~"]),
  ];

  const dedupe = new Map<string, DedupeEntry>();
  let tokens = rateLimit.capacity;
  let refilledAt = now();
  let droppedByRate = 0;
  // Every write goes through one promise chain. Two concurrent appends would
  // otherwise interleave their rotation checks and lose a whole generation.
  let chain: Promise<void> = Promise.resolve();
  let knownSize: number | null = null;

  const enqueue = (line: string): void => {
    chain = chain.then(() => writeLine(line)).catch(() => undefined);
  };

  async function writeLine(line: string): Promise<void> {
    try {
      await mkdir(options.directory, { recursive: true, mode: 0o700 });
      if (knownSize === null)
        knownSize = await stat(path).then(
          (value) => value.size,
          () => 0,
        );
      if (knownSize + Buffer.byteLength(line, "utf8") > maxFileBytes) {
        await rotate();
        knownSize = 0;
      }
      await appendFile(path, line, { encoding: "utf8", mode: 0o600 });
      knownSize += Buffer.byteLength(line, "utf8");
    } catch {
      // A diagnostic must never become the failure it was reporting.
      knownSize = null;
    }
  }

  async function rotate(): Promise<void> {
    await rm(`${path}.${retained}`, { force: true });
    for (let generation = retained - 1; generation >= 1; generation -= 1) {
      await rename(`${path}.${generation}`, `${path}.${generation + 1}`).catch(() => undefined);
    }
    if (retained >= 1) await rename(path, `${path}.1`).catch(() => undefined);
    else await rm(path, { force: true });
  }

  const emit = (record: DiagnosticRecord): void => {
    const line = serialize(record, maxLineBytes, abbreviations);
    if (line !== null) enqueue(`${line}\n`);
  };

  const closeWindow = (fingerprint: string, entry: DedupeEntry): void => {
    dedupe.delete(fingerprint);
    if (entry.suppressed > 0) {
      emit({
        at: new Date(now()).toISOString(),
        code: entry.code,
        severity: "warn",
        area: entry.area,
        stage: entry.stage,
        detail: { fingerprint, repeated: entry.suppressed },
      });
    }
  };

  const takeToken = (at: number): boolean => {
    tokens = Math.min(rateLimit.capacity, tokens + ((at - refilledAt) / 1_000) * rateLimit.refillPerSecond);
    refilledAt = at;
    if (tokens < 1) {
      droppedByRate += 1;
      return false;
    }
    tokens -= 1;
    if (droppedByRate > 0) {
      const dropped = droppedByRate;
      droppedByRate = 0;
      emit({ at: new Date(at).toISOString(), code: "diagnostics_throttled", severity: "warn", detail: { dropped } });
    }
    return true;
  };

  return {
    append(record: DiagnosticRecord): void {
      try {
        const at = now();
        const redacted = redactDiagnostic({ at: new Date(at).toISOString(), ...record });
        const fingerprint = fingerprintOf(redacted);
        const entry = dedupe.get(fingerprint);
        if (entry) {
          if (at - entry.openedAt < dedupeWindowMs) {
            entry.suppressed += 1;
            return;
          }
          closeWindow(fingerprint, entry);
        }
        if (!takeToken(at)) return;
        if (dedupe.size >= MAX_TRACKED_FINGERPRINTS) {
          const oldest = dedupe.entries().next();
          if (!oldest.done) closeWindow(oldest.value[0], oldest.value[1]);
        }
        dedupe.set(fingerprint, {
          openedAt: at,
          suppressed: 0,
          code: redacted.code,
          area: redacted.area,
          stage: redacted.stage,
        });
        emit({ ...redacted, detail: { ...redacted.detail, fingerprint } });
      } catch {
        // As above: reporting a failure may not raise one.
      }
    },
    async flush(): Promise<void> {
      for (const [fingerprint, entry] of [...dedupe]) closeWindow(fingerprint, entry);
      if (droppedByRate > 0) {
        const dropped = droppedByRate;
        droppedByRate = 0;
        emit({
          at: new Date(now()).toISOString(),
          code: "diagnostics_throttled",
          severity: "warn",
          detail: { dropped },
        });
      }
      await chain;
    },
    async prune(): Promise<void> {
      await pruneLogTree({
        root: options.sweepDirectory ?? dirname(options.directory),
        maxTreeBytes: options.maxTreeBytes ?? DEFAULT_MAX_TREE_BYTES,
        maxFileAgeMs: options.maxFileAgeMs ?? DEFAULT_MAX_FILE_AGE_MS,
        now: now(),
      });
    },
  };
}

/**
 * Rotation keeps the newest bytes and drops the oldest file. Truncating in
 * place would do the opposite of what a reader needs.
 */
function serialize(record: DiagnosticRecord, maxLineBytes: number, abbreviations: [string, string][]): string | null {
  const abbreviated = abbreviateRecord(record, abbreviations);
  // Include the line separator and JSON escaping in the byte limit.
  const fits = (line: string): boolean => Buffer.byteLength(line, "utf8") + 1 <= maxLineBytes;
  let line = JSON.stringify(abbreviated);
  if (fits(line)) return line;
  const detail = { ...(abbreviated.detail ?? {}) };
  const bounded = { ...abbreviated, detail, truncated: true };
  // Keep the link to repeat summaries even when the original message needs truncation.
  const byWeight = Object.keys(detail)
    .filter((key) => key !== "fingerprint")
    .sort((left, right) => JSON.stringify(detail[right] ?? null).length - JSON.stringify(detail[left] ?? null).length);
  for (const key of byWeight) {
    delete detail[key];
    line = JSON.stringify(bounded);
    if (fits(line)) return line;
  }
  // A message can contain multibyte characters or JSON escape sequences.
  // Search the serialized size, not the source string's character count.
  for (const key of ["message", "area", "stage", "code", "at"] as const) {
    const value = bounded[key];
    if (!value) continue;
    let low = 0;
    let high = value.length;
    while (low < high) {
      const middle = Math.ceil((low + high) / 2);
      bounded[key] = value.slice(0, middle);
      if (fits(JSON.stringify(bounded))) low = middle;
      else high = middle - 1;
    }
    bounded[key] = value.slice(0, low);
    line = JSON.stringify(bounded);
    if (fits(line)) return line;
  }
  const marker = '{"truncated":true}';
  return fits(marker) ? marker : null;
}

function abbreviateRecord(
  record: DiagnosticRecord,
  abbreviations: [string, string][],
): DiagnosticRecord & { truncated?: boolean } {
  if (abbreviations.length === 0) return record;
  const shorten = (value: LogValue): LogValue => {
    if (typeof value === "string") {
      let text = value;
      for (const [from, to] of abbreviations) text = text.split(from).join(to);
      return text;
    }
    if (Array.isArray(value)) return value.map(shorten);
    if (typeof value === "object" && value !== null) {
      return Object.fromEntries(Object.entries(value).map(([key, entry]) => [key, shorten(entry)]));
    }
    return value;
  };
  const detail = record.detail ? shorten(record.detail) : undefined;
  return {
    ...record,
    ...(record.message === undefined ? {} : { message: String(shorten(record.message)) }),
    ...(detail && typeof detail === "object" && !Array.isArray(detail) ? { detail } : {}),
  };
}

function uniquePrefixes(directory: string | undefined): string[] {
  if (!directory) return [];
  const redacted = redactText(directory);
  return redacted === directory ? [directory] : [directory, redacted];
}

function fingerprintOf(record: DiagnosticRecord): string {
  const detail = record.detail ?? {};
  const identity = FINGERPRINT_KEYS.filter((key) => detail[key] !== undefined).map(
    (key) => `${key}=${JSON.stringify(detail[key], (name, value) => (name === "durationMs" ? undefined : value))}`,
  );
  return createHash("sha256")
    .update(JSON.stringify([record.code, record.area, record.stage, record.message, ...identity]))
    .digest("hex");
}

interface PruneOptions {
  root: string;
  maxTreeBytes: number;
  maxFileAgeMs: number;
  now: number;
}

interface TreeFile {
  path: string;
  size: number;
  modifiedAt: number;
}

/**
 * The sweep covers the whole `logs` tree rather than this writer's own
 * directory, because nothing else reclaims a file an earlier release left
 * behind under a name no current writer knows.
 */
export async function pruneLogTree(options: PruneOptions): Promise<void> {
  try {
    const files = await collectFiles(options.root);
    const kept: TreeFile[] = [];
    for (const file of files) {
      if (options.now - file.modifiedAt > options.maxFileAgeMs || !/\.log(?:\.\d+)?$/u.test(file.path)) {
        await rm(file.path, { force: true });
        continue;
      }
      kept.push(file);
    }
    let total = kept.reduce((sum, file) => sum + file.size, 0);
    for (const file of kept.sort((left, right) => left.modifiedAt - right.modifiedAt)) {
      if (total <= options.maxTreeBytes) break;
      await rm(file.path, { force: true });
      total -= file.size;
    }
  } catch {
    // The log tree does not exist until something writes to it.
  }
}

async function collectFiles(directory: string): Promise<TreeFile[]> {
  const entries = await readdir(directory, { withFileTypes: true }).catch(() => []);
  const files: TreeFile[] = [];
  for (const entry of entries) {
    const entryPath = join(directory, entry.name);
    if (entry.isDirectory()) {
      files.push(...(await collectFiles(entryPath)));
      continue;
    }
    if (!entry.isFile()) continue;
    const stats = await stat(entryPath).catch(() => null);
    if (stats) files.push({ path: entryPath, size: stats.size, modifiedAt: stats.mtimeMs });
  }
  return files;
}

// One chain per file, so two process streams writing at once cannot interleave
// their rotation checks and lose a whole generation between them. The previous
// remote writer had no chain at all.
const textChains = new Map<string, Promise<void>>();

/**
 * The same bound and the same redaction as the record log, for the one input
 * that is not a record: raw output from a child process. Nothing here is
 * OpenBot's own text, which is why it never leaves the machine.
 */
export async function appendTextLog(options: {
  directory: string;
  fileName: string;
  text: string;
  maxFileBytes?: number;
  maxTextBytes?: number;
}): Promise<void> {
  const path = join(options.directory, options.fileName);
  const maxFileBytes = options.maxFileBytes ?? DEFAULT_MAX_FILE_BYTES;
  const maxTextBytes = Math.min(options.maxTextBytes ?? DEFAULT_MAX_TEXT_BYTES, maxFileBytes);
  const redacted = redactText(options.text);
  let clean = "";
  let bytes = 0;
  for (const character of redacted) {
    bytes += Buffer.byteLength(character, "utf8");
    if (bytes > maxTextBytes) break;
    clean += character;
  }
  if (!clean) return;
  const next = (textChains.get(path) ?? Promise.resolve()).then(async () => {
    try {
      await mkdir(options.directory, { recursive: true, mode: 0o700 });
      const size = await stat(path).then(
        (value) => value.size,
        () => 0,
      );
      if (size + Buffer.byteLength(clean, "utf8") > maxFileBytes) {
        await rm(`${path}.1`, { force: true });
        await rename(path, `${path}.1`);
      }
      await appendFile(path, clean, { encoding: "utf8", mode: 0o600 });
    } catch {
      // A diagnostic must never become the failure it was reporting.
    }
  });
  textChains.set(path, next);
  await next;
}
