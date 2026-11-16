import { randomUUID } from "node:crypto";
import { mkdir, open, rename, rm } from "node:fs/promises";
import { dirname } from "node:path";
import { sourceText } from "@openbot/i18n/source";
import { Effect, Result, Schema } from "effect";

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
 * True when the file is empty, or has its size but none of its content. A power loss can leave a
 * file this way on NTFS, which records the size before the data. Nothing in such a file can be
 * recovered.
 */
export function isEmptyStoredFile(contents: string): boolean {
  return contents.replaceAll("\0", "").trim() === "";
}

/**
 * Parses the JSON text of the stored file at `path` and gives it to `decode`. A byte order mark that
 * an editor added is ignored. A parse error names the file and quotes nothing from it: the V8 message
 * quotes the text, and a stored file can hold tokens.
 */
export function parseStoredJson<Value>(path: string, contents: string, decode: (value: unknown) => Value): Value {
  let value: unknown;
  try {
    value = JSON.parse(contents.startsWith("\uFEFF") ? contents.slice(1) : contents);
  } catch {
    throw new Error(sourceText("error.storage.unreadableFile", { path }));
  }
  return decode(value);
}

/**
 * Moves a damaged file to `<path>.corrupt-<time>`, where it stays for diagnosis. A failed move is
 * ignored: the next write replaces the file, and the file holds nothing to keep.
 */
export const setAsideDamagedFile = Effect.fn("AtomicFile.setAsideDamaged")(function* (path: string) {
  yield* Effect.promise(() => rename(path, `${path}.corrupt-${Date.now()}`).catch(() => undefined));
});

/** The native cause stays at the adapter; callers must not export it without redaction. */
export class AtomicFileWriteError extends Schema.TaggedError<AtomicFileWriteError>()("AtomicFileWriteError", {
  operation: Schema.Literals(["directory", "write", "rename"]),
  cause: Schema.Defect(),
}) {}

/**
 * The waits before each new rename when Windows answers `EPERM`, `EACCES` or `EBUSY`. Windows gives
 * these when antivirus, the search indexer or a backup tool has the target file open for a moment. A failed
 * rename of the team file at sign-in leaves the host with no id, and Slack, Discord and Telegram then
 * cannot connect. On other systems these codes are permanent permission errors, so they fail at once.
 *
 * On some Windows computers a filter driver holds every new file in the data folder, so each rename
 * fails, while a write to an existing file works (#10580). After the last wait, the content is then
 * written over `path` in place, and later writes of `path` in this process skip the temporary file:
 * the driver can also hold it against the delete, and each save would leave one behind.
 */
const HELD_TARGET_WAITS_MS: readonly number[] = [10, 50, 100, 250, 500];

export function isHeldTargetError(cause: unknown): boolean {
  if (process.platform !== "win32") return false;
  const code = cause instanceof Error && "code" in cause ? cause.code : null;
  return code === "EPERM" || code === "EACCES" || code === "EBUSY";
}

/** Writes `content` to `path`, readable only by the user, and flushes it to the disk. */
async function writeAndFlush(path: string, content: string | Uint8Array): Promise<void> {
  const handle = await open(path, "w", 0o600);
  try {
    await handle.writeFile(content);
    await handle.sync();
  } catch (cause) {
    // A close failure must not replace the write failure.
    await handle.close().catch(() => undefined);
    throw cause;
  }
  await handle.close();
}

/**
 * The last in-place write of each path. Two in-place writes to one file at the same time can leave
 * the end of the longer content after the shorter one, so each write waits for the one before it.
 */
const inPlaceWrites = new Map<string, Promise<void>>();

/** The paths whose rename failed after every wait. Only Windows adds to it. */
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

/**
 * Replaces `path` with `content`, readable only by the user.
 *
 * The content goes to a temporary sibling first and is renamed over `path`, so a crash leaves the
 * previous file or the new one, never a truncated one. The content is flushed to the disk before the
 * rename, so a power loss cannot leave `path` filled with zeros. Each call has its own temporary name, so
 * overlapping writes never share a file, and a failed write removes its temporary file. When Windows
 * holds the files for longer than the rename waits, the content is written over `path` in place, now
 * and on each later write of `path` in this process.
 *
 * The write and rename stay together even when the caller interrupts the operation.
 */
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
  // A crash during an in-place write can leave `path` incomplete. Without it, no change is ever saved.
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
    // Cleanup failure must not replace the write failure, as in the native adapter. The retries wait
    // for a Windows hold on the temporary file (`EBUSY`, `EPERM`); a missing file ends at once.
    (temporaryPath) =>
      Effect.promise(() => rm(temporaryPath, { force: true, maxRetries: 5, retryDelay: 100 }).catch(() => undefined)),
  );
}, Effect.uninterruptible);
