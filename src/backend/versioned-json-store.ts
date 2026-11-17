import { readFile } from "node:fs/promises";
import { type DynamicRecord, isDynamicRecord } from "@openbot/contracts/runtime-values";
import { Effect, Result } from "effect";
import { isEmptyStoredFile, setAsideDamagedFile } from "./atomic-json-file";
import { isMissingFileError } from "./file-errors";

/**
 * How a store reads its versioned JSON file. `current` is the version that this build writes.
 * `releases` has one step for each released version, `current` included. A step changes the file of
 * its version into the value of this build, or throws when the file is not valid for its version.
 */
export interface VersionedJsonFormat<Value> {
  readonly current: number;
  readonly releases: Readonly<Record<number, (file: DynamicRecord) => Value>>;
}

/**
 * What a read found at the store's path:
 * - `missing`: no file.
 * - `loaded`: a released version.
 * - `damaged`: not JSON. The file is now at `<path>.corrupt-<time>`.
 * - `kept`: JSON that this build cannot read, such as the file of a newer release. It stays unchanged.
 * - `unreadable`: the read failed, for example on a permission error. It stays unchanged.
 */
type VersionedJsonFileState = "missing" | "loaded" | "damaged" | "kept" | "unreadable";

interface VersionedJsonLoad<Value> {
  /** Null when there is no file that this build can read: the store starts from its defaults. */
  readonly value: Value | null;
  /** The file that this build writes, and deletes when the user deletes the data. */
  readonly writePath: string;
  readonly state: VersionedJsonFileState;
}

/**
 * The file that a build writes while the store's path holds JSON it cannot read, such as the file of
 * a newer release after a downgrade.
 */
export function versionedJsonFallbackPath(path: string, version: number): string {
  return `${path}.v${version}`;
}

/**
 * Reads the versioned JSON file of a store, and never writes. A file that is not JSON goes to
 * `<path>.corrupt-<time>`. JSON that this build cannot read, such as the file of a newer release after
 * a downgrade, and a path that cannot be read stay unchanged: this build reads and writes
 * `<path>.v<current>` in their place. Stores must write to `writePath`, never to the path.
 */
export const readVersionedJsonFile = Effect.fn("VersionedJson.read")(function* <Value>(
  path: string,
  format: VersionedJsonFormat<Value>,
) {
  const main = yield* readOneFile(path, format);
  if (main.state !== "kept" && main.state !== "unreadable") {
    const load: VersionedJsonLoad<Value> = { value: main.value, writePath: path, state: main.state };
    return load;
  }
  const fallbackPath = versionedJsonFallbackPath(path, format.current);
  const fallback = yield* readOneFile(fallbackPath, format);
  // The fallback is the file of this build. A fallback that this build cannot read is replaced at
  // the next write, as the path of a store without a newer file is.
  const load: VersionedJsonLoad<Value> = { value: fallback.value, writePath: fallbackPath, state: main.state };
  return load;
});

interface OneFile<Value> {
  readonly value: Value | null;
  readonly state: VersionedJsonFileState;
}

const readOneFile = Effect.fn("VersionedJson.readOne")(function* <Value>(
  path: string,
  format: VersionedJsonFormat<Value>,
) {
  const read = yield* Effect.result(Effect.tryPromise(() => readFile(path, "utf8")));
  if (Result.isFailure(read)) {
    const missing: OneFile<Value> = {
      value: null,
      state: isMissingFileError(read.failure.cause) ? "missing" : "unreadable",
    };
    return missing;
  }
  const parsed = parseJson(read.success);
  if (!parsed.ok) {
    yield* setAsideDamagedFile(path);
    const damaged: OneFile<Value> = { value: null, state: "damaged" };
    return damaged;
  }
  const kept: OneFile<Value> = { value: null, state: "kept" };
  const file = parsed.value;
  if (!isDynamicRecord(file)) return kept;
  const version = file.version;
  if (typeof version !== "number") return kept;
  const step = format.releases[version];
  if (!step) return kept;
  const decoded = yield* Effect.result(Effect.try(() => step(file)));
  if (Result.isFailure(decoded)) return kept;
  const loaded: OneFile<Value> = { value: decoded.success, state: "loaded" };
  return loaded;
});

/**
 * An empty file, or one that a power loss filled with zeros, is not JSON. A byte order mark that an
 * editor added is ignored.
 */
function parseJson(contents: string): { ok: true; value: unknown } | { ok: false } {
  if (isEmptyStoredFile(contents)) return { ok: false };
  try {
    return { ok: true, value: JSON.parse(contents.startsWith("﻿") ? contents.slice(1) : contents) };
  } catch {
    return { ok: false };
  }
}
