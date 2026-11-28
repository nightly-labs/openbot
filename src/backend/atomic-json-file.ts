import { randomUUID } from "node:crypto";
import { mkdir, open, rename, rm } from "node:fs/promises";
import { dirname } from "node:path";
import { sourceText } from "@openbot/i18n/source";
import { Effect, Result, Schema } from "effect";

export interface VersionedJsonFile {
  version: number;
}

export interface WriteJsonFileOptions {
  createDirectory?: boolean;
}

export function writeJsonFileAtomically<Content extends VersionedJsonFile>(
  path: string,
  value: Content,
  options: WriteJsonFileOptions = {},
): Effect.Effect<void, AtomicFileWriteError> {
  return writeFileAtomically(path, `${JSON.stringify(value)}\n`, options);
}

export function isEmptyStoredFile(contents: string): boolean {
  return contents.replaceAll("\0", "").trim() === "";
}

export function parseStoredJson<Value>(path: string, contents: string, decode: (value: unknown) => Value): Value {
  let value: unknown;
  try {
    value = JSON.parse(contents.startsWith("\uFEFF") ? contents.slice(1) : contents);
  } catch {
    throw new Error(sourceText("error.storage.unreadableFile", { path }));
  }
  return decode(value);
}

export const setAsideDamagedFile = Effect.fn("AtomicFile.setAsideDamaged")(function* (path: string) {
  yield* Effect.promise(() => rename(path, `${path}.corrupt-${Date.now()}`).catch(() => undefined));
});

export class AtomicFileWriteError extends Schema.TaggedError<AtomicFileWriteError>()("AtomicFileWriteError", {
  operation: Schema.Literals(["directory", "write", "rename"]),
  cause: Schema.Defect(),
}) {}

export const HELD_TARGET_WAITS_MS: readonly number[] = [10, 50, 100, 250, 500];

export function isHeldTargetError(cause: unknown): boolean {
  if (process.platform !== "win32") return false;
  const code = cause instanceof Error && "code" in cause ? cause.code : null;
  return code === "EPERM" || code === "EACCES" || code === "EBUSY";
}

async function writeAndFlush(path: string, content: string | Uint8Array): Promise<void> {
  const handle = await open(path, "w", 0o600);
  try {
    await handle.writeFile(content);
    await handle.sync();
  } catch (cause) {
    await handle.close().catch(() => undefined);
    throw cause;
  }
  await handle.close();
}

const inPlaceWrites = new Map<string, Promise<void>>();

const inPlacePaths = new Set<string>();

function writeInPlace(path: string, content: string | Uint8Array): Promise<void> {
  inPlacePaths.add(path);
  const write = (inPlaceWrites.get(path) ?? Promise.resolve()).then(() => writeAndFlush(path, content));
  const settled = write.catch(() => undefined);
  inPlaceWrites.set(path, settled);
  void settled.then(() => {
    if (inPlaceWrites.get(path) === settled) inPlaceWrites.delete(path);
  });
  return write;
}

export const writeFileAtomically = Effect.fn("AtomicFile.write")(function* (
  path: string,
  content: string | Uint8Array,
  options: WriteJsonFileOptions = {},
) {
  if (options.createDirectory) {
    yield* Effect.tryPromise({
      try: () => mkdir(dirname(path), { recursive: true, mode: 0o700 }),
      catch: (cause) => new AtomicFileWriteError({ operation: "directory", cause }),
    });
  }
  if (inPlacePaths.has(path))
    return yield* Effect.tryPromise({
      try: () => writeInPlace(path, content),
      catch: (cause) => new AtomicFileWriteError({ operation: "write", cause }),
    });
  yield* Effect.acquireUseRelease(
    Effect.sync(() => `${path}.${randomUUID()}.tmp`),
    (temporaryPath) =>
      Effect.gen(function* () {
        yield* Effect.tryPromise({
          try: () => writeAndFlush(temporaryPath, content),
          catch: (cause) => new AtomicFileWriteError({ operation: "write", cause }),
        });
        for (let attempt = 0; ; attempt += 1) {
          const renamed = yield* Effect.result(
            Effect.tryPromise({
              try: () => rename(temporaryPath, path),
              catch: (cause) => new AtomicFileWriteError({ operation: "rename", cause }),
            }),
          );
          if (Result.isSuccess(renamed)) return;
          if (!isHeldTargetError(renamed.failure.cause)) return yield* renamed.failure;
          const wait = HELD_TARGET_WAITS_MS[attempt];
          if (wait === undefined)
            return yield* Effect.tryPromise({
              try: () => writeInPlace(path, content),
              catch: (cause) => new AtomicFileWriteError({ operation: "write", cause }),
            });
          yield* Effect.sleep(wait);
        }
      }),
    (temporaryPath) =>
      Effect.promise(() => rm(temporaryPath, { force: true, maxRetries: 5, retryDelay: 100 }).catch(() => undefined)),
  );
}, Effect.uninterruptible);
