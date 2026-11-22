import { readFile } from "node:fs/promises";
import { type DynamicRecord, isDynamicRecord } from "@openbot/contracts/runtime-values";
import { Effect, Result } from "effect";
import { isEmptyStoredFile, setAsideDamagedFile } from "./atomic-json-file";
import { isMissingFileError } from "./file-errors";

export interface VersionedJsonFormat<Value> {
  readonly current: number;
  readonly releases: Readonly<Record<number, (file: DynamicRecord) => Value>>;
}

type VersionedJsonFileState = "missing" | "loaded" | "damaged" | "kept" | "unreadable";

interface VersionedJsonLoad<Value> {
  readonly value: Value | null;
  readonly writePath: string;
  readonly state: VersionedJsonFileState;
}

export function versionedJsonFallbackPath(path: string, version: number): string {
  return `${path}.v${version}`;
}

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
  const file = parsed.ok && isDynamicRecord(parsed.value) ? parsed.value : null;
  const version = typeof file?.version === "number" ? file.version : null;
  if (version !== null && version > format.current) {
    const kept: OneFile<Value> = { value: null, state: "kept" };
    return kept;
  }
  const step = version === null ? undefined : format.releases[version];
  if (file && step) {
    const decoded = yield* Effect.result(Effect.try(() => step(file)));
    if (Result.isSuccess(decoded)) {
      const loaded: OneFile<Value> = { value: decoded.success, state: "loaded" };
      return loaded;
    }
  }
  yield* setAsideDamagedFile(path);
  const damaged: OneFile<Value> = { value: null, state: "damaged" };
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
