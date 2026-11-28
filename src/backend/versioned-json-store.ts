import { readFile } from "node:fs/promises";
import { type DynamicRecord, isDynamicRecord } from "@openbot/contracts/runtime-values";
import { Effect, Result } from "effect";
import {
  HELD_TARGET_WAITS_MS,
  isEmptyStoredFile,
  isHeldTargetError,
  setAsideDamagedFile,
  writeFileAtomically,
} from "./atomic-json-file";
import { isMissingFileError } from "./file-errors";

export interface VersionedJsonFormat<Value> {
  readonly current: number;
  readonly releases: Readonly<Record<number, (file: DynamicRecord) => Value>>;
  readonly keepLastGood?: boolean;
}

type VersionedJsonFileState = "missing" | "loaded" | "restored" | "damaged" | "kept" | "unreadable";

interface VersionedJsonLoad<Value> {
  readonly value: Value | null;
  readonly writePath: string;
  readonly state: VersionedJsonFileState;
}

export function versionedJsonFallbackPath(path: string, version: number): string {
  return `${path}.v${version}`;
}

export function versionedJsonLastGoodPath(path: string): string {
  return `${path}.last-good`;
}

export const readVersionedJsonFile = Effect.fn("VersionedJson.read")(function* <Value>(
  path: string,
  format: VersionedJsonFormat<Value>,
) {
  const main = yield* readOneFile(path, format);
  if (main.state === "loaded" && format.keepLastGood && main.contents !== null) {
    yield* writeFileAtomically(versionedJsonLastGoodPath(path), main.contents).pipe(Effect.ignore);
  }
  if (main.state === "damaged" || main.state === "missing") {
    const lastGood = yield* readLastGood(path, format);
    const load: VersionedJsonLoad<Value> =
      lastGood === null
        ? { value: null, writePath: path, state: main.state }
        : { value: lastGood, writePath: path, state: "restored" };
    return load;
  }
  if (main.state === "loaded") {
    const load: VersionedJsonLoad<Value> = { value: main.value, writePath: path, state: main.state };
    return load;
  }
  const fallbackPath = versionedJsonFallbackPath(path, format.current);
  const fallback = yield* readOneFile(fallbackPath, format);
  const value = fallback.value ?? (main.state === "unreadable" ? yield* readLastGood(path, format) : null);
  const load: VersionedJsonLoad<Value> = { value, writePath: fallbackPath, state: main.state };
  return load;
});

const readLastGood = Effect.fn("VersionedJson.readLastGood")(function* <Value>(
  path: string,
  format: VersionedJsonFormat<Value>,
) {
  if (!format.keepLastGood) return null;
  const lastGood = yield* readOneFile(versionedJsonLastGoodPath(path), format);
  return lastGood.state === "loaded" ? lastGood.value : null;
});

interface OneFile<Value> {
  readonly value: Value | null;
  readonly contents: string | null;
  readonly state: VersionedJsonFileState;
}

const readHeldFile = Effect.fn("VersionedJson.readHeld")(function* (path: string) {
  for (let attempt = 0; ; attempt += 1) {
    const read = yield* Effect.result(Effect.tryPromise(() => readFile(path, "utf8")));
    const wait = HELD_TARGET_WAITS_MS[attempt];
    if (Result.isSuccess(read) || wait === undefined || !isHeldTargetError(read.failure.cause)) return read;
    yield* Effect.sleep(wait);
  }
});

const readOneFile = Effect.fn("VersionedJson.readOne")(function* <Value>(
  path: string,
  format: VersionedJsonFormat<Value>,
) {
  const read = yield* readHeldFile(path);
  if (Result.isFailure(read)) {
    const missing: OneFile<Value> = {
      value: null,
      contents: null,
      state: isMissingFileError(read.failure.cause) ? "missing" : "unreadable",
    };
    return missing;
  }
  const parsed = parseJson(read.success);
  const file = parsed.ok && isDynamicRecord(parsed.value) ? parsed.value : null;
  const version = typeof file?.version === "number" ? file.version : null;
  if (version !== null && version > format.current) {
    const kept: OneFile<Value> = { value: null, contents: null, state: "kept" };
    return kept;
  }
  const step = version === null ? undefined : format.releases[version];
  if (file && step) {
    const decoded = yield* Effect.result(Effect.try(() => step(file)));
    if (Result.isSuccess(decoded)) {
      const loaded: OneFile<Value> = { value: decoded.success, contents: read.success, state: "loaded" };
      return loaded;
    }
  }
  yield* setAsideDamagedFile(path);
  const damaged: OneFile<Value> = { value: null, contents: null, state: "damaged" };
  return damaged;
});

function parseJson(contents: string): { ok: true; value: unknown } | { ok: false } {
  if (isEmptyStoredFile(contents)) return { ok: false };
  try {
    return { ok: true, value: JSON.parse(contents.startsWith("﻿") ? contents.slice(1) : contents) };
  } catch {
    return { ok: false };
  }
}
