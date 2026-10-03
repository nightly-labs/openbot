import { randomUUID } from "node:crypto";
import { mkdir, rename, rm, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { Effect, Schema } from "effect";

/** Every stored JSON file carries a schema version, so a later release can read an older one. */
export interface VersionedJsonFile {
  version: number;
}

export interface WriteJsonFileOptions {
  /** Creates the parent directory, readable only by the user, when it is missing. */
  createDirectory?: boolean;
}

/** Replaces `path` with `value` as one line of JSON, readable only by the user. */
export function writeJsonFileAtomically<Content extends VersionedJsonFile>(
  path: string,
  value: Content,
  options: WriteJsonFileOptions = {},
): Effect.Effect<void, AtomicFileWriteError> {
  return writeFileAtomically(path, `${JSON.stringify(value)}\n`, options);
}

/**
 * Replaces `path` with `content`, readable only by the user.
 *
 * The content goes to a temporary sibling first and is renamed over `path`, so a crash leaves the
 * previous file or the new one, never a truncated one. Each call has its own temporary name, so
 * overlapping writes never share a file, and a failed write removes its temporary file.
 */
/** The native cause stays at the adapter; callers must not export it without redaction. */
export class AtomicFileWriteError extends Schema.TaggedError<AtomicFileWriteError>()("AtomicFileWriteError", {
  operation: Schema.Literals(["directory", "write", "rename"]),
  cause: Schema.Defect(),
}) {}

/** Keep the write and rename together even when the caller interrupts the operation. */
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
  yield* Effect.acquireUseRelease(
    Effect.sync(() => `${path}.${randomUUID()}.tmp`),
    (temporaryPath) =>
      Effect.gen(function* () {
        yield* Effect.tryPromise({
          try: () => writeFile(temporaryPath, content, { mode: 0o600 }),
          catch: (cause) => new AtomicFileWriteError({ operation: "write", cause }),
        });
        yield* Effect.tryPromise({
          try: () => rename(temporaryPath, path),
          catch: (cause) => new AtomicFileWriteError({ operation: "rename", cause }),
        });
      }),
    // Cleanup failure must not replace the write failure, as in the native adapter.
    (temporaryPath) => Effect.promise(() => rm(temporaryPath, { force: true }).catch(() => undefined)),
  );
}, Effect.uninterruptible);
