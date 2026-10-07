import { execFile } from "node:child_process";
import { createReadStream, createWriteStream } from "node:fs";
import { type FileHandle, mkdir, open, readdir, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { Transform } from "node:stream";
import { pipeline } from "node:stream/promises";
import { promisify } from "node:util";
import { crc32, createInflateRaw } from "node:zlib";
import { sourceText } from "@openbot/i18n/source";
import { Effect } from "effect";
import { ProviderRuntimeFailure, runtimeIO } from "./provider-runtime-effects";

const execFileAsync = promisify(execFile);

const MAX_ARCHIVE_LIST_BYTES = 16 * 1024 * 1024;
export const assertSafeArchive = Effect.fn("ProviderArchive.assertSafeArchive")(function* (
  path: string,
  allowedRoots: readonly string[],
  message: string,
): Effect.fn.Return<void, ProviderRuntimeFailure> {
  const [{ stdout: namesValue }, { stdout: detailsValue }] = yield* Effect.all(
    [
      runtimeIO((signal) =>
        execFileAsync("tar", ["-tzf", path], { encoding: "utf8", maxBuffer: MAX_ARCHIVE_LIST_BYTES, signal }),
      ),
      runtimeIO((signal) =>
        execFileAsync("tar", ["-tvzf", path], { encoding: "utf8", maxBuffer: MAX_ARCHIVE_LIST_BYTES, signal }),
      ),
    ],
    { concurrency: "unbounded" },
  );
  const names = namesValue.split(/\r?\n/u).filter(Boolean);
  const details = detailsValue.split(/\r?\n/u).filter(Boolean);
  if (details.some((line) => !["-", "d"].includes(line.trimStart().charAt(0)))) {
    return yield* new ProviderRuntimeFailure({ cause: new Error(sourceText("error.provider.archiveSpecialFile")) });
  }
  for (const name of names) {
    if (name.includes("\0") || name.includes("\\"))
      return yield* new ProviderRuntimeFailure({ cause: new Error(sourceText("error.provider.archiveUnsafePath")) });
    const normalized = name.replace(/\/+$/u, "");
    const parts = normalized.split("/");
    if (
      !normalized ||
      normalized.startsWith("/") ||
      /^[A-Za-z]:/u.test(normalized) ||
      parts.some((part) => !part || part === "." || part === "..")
    ) {
      return yield* new ProviderRuntimeFailure({ cause: new Error(sourceText("error.provider.archiveUnsafePath")) });
    }
    if (!allowedRoots.includes(parts[0] ?? "")) return yield* new ProviderRuntimeFailure({ cause: new Error(message) });
  }
});
export const extractArchive = Effect.fn("ProviderArchive.extractArchive")(function* (
  archive: string,
  destination: string,
): Effect.fn.Return<void, ProviderRuntimeFailure> {
  yield* runtimeIO((signal) =>
    execFileAsync("tar", ["-xzf", archive, "-C", destination, "--no-same-owner"], {
      encoding: "utf8",
      maxBuffer: MAX_ARCHIVE_LIST_BYTES,
      signal,
    }),
  );
});

interface ZipEntry {
  name: string;
  method: number;
  crc: number;
  compressedBytes: number;
  bytes: number;
  localHeaderOffset: number;
}

/** The largest end-of-central-directory record: 22 bytes and a comment of up to 64 KB. */
const ZIP_END_MAX_BYTES = 22 + 0xffff;
const ZIP_UNIX_TYPE_MASK = 0o170000;
const ZIP_UNIX_REGULAR_FILE = 0o100000;
const ZIP_UNIX_DIRECTORY = 0o040000;
export const extractZipFiles = Effect.fn("ProviderArchive.extractZipFiles")(function* (
  archive: string,
  destination: string,
  names: readonly string[],
  message: string,
): Effect.fn.Return<void, ProviderRuntimeFailure> {
  yield* Effect.acquireUseRelease(
    runtimeIO(() => open(archive, "r")),
    (handle) =>
      Effect.gen(function* () {
        const entries = yield* readZipDirectoryEffect(handle, (name) => names.includes(name), message);
        if (entries.length !== names.length) return yield* new ProviderRuntimeFailure({ cause: new Error(message) });
        for (const entry of entries) {
          const dataStart = yield* zipDataOffsetEffect(handle, entry);
          yield* extractZipEntryEffect(archive, dataStart, entry, join(destination, entry.name));
        }
      }),
    (handle) => runtimeIO(() => handle.close()).pipe(Effect.orDie),
  );
});
export const extractZipTree = Effect.fn("ProviderArchive.extractZipTree")(function* (
  archive: string,
  destination: string,
  root: string,
  message: string,
): Effect.fn.Return<void, ProviderRuntimeFailure> {
  yield* Effect.acquireUseRelease(
    runtimeIO(() => open(archive, "r")),
    (handle) =>
      Effect.gen(function* () {
        const entries = yield* readZipDirectoryEffect(handle, (name) => isZipTreeName(name, root), message);
        for (const entry of entries) {
          const path = join(destination, ...entry.name.replace(/\/$/u, "").split("/"));
          if (entry.name.endsWith("/")) {
            yield* runtimeIO(() => mkdir(path, { recursive: true }));
            continue;
          }
          yield* runtimeIO(() => mkdir(dirname(path), { recursive: true }));
          const dataStart = yield* zipDataOffsetEffect(handle, entry);
          yield* extractZipEntryEffect(archive, dataStart, entry, path);
        }
      }),
    (handle) => runtimeIO(() => handle.close()).pipe(Effect.orDie),
  );
});

function isZipTreeName(name: string, root: string): boolean {
  if (name.includes("\0") || name.includes("\\")) return false;
  const parts = name.replace(/\/$/u, "").split("/");
  // A `:` names an NTFS stream on Windows, which would write beside the file rather than into it.
  return parts[0] === root && parts.every((part) => part && part !== "." && part !== ".." && !part.includes(":"));
}

const readZipDirectoryEffect = Effect.fn("ProviderArchive.readZipDirectory")(function* (
  handle: FileHandle,
  accepts: (name: string) => boolean,
  message: string,
): Effect.fn.Return<ZipEntry[], ProviderRuntimeFailure> {
  const { size } = yield* runtimeIO(() => handle.stat());
  const tailBytes = Math.min(size, ZIP_END_MAX_BYTES);
  const tail = yield* readAtEffect(handle, size - tailBytes, tailBytes);
  let end = -1;
  for (let index = tail.length - 22; index >= 0; index -= 1) {
    if (tail.readUInt32LE(index) === 0x06054b50) {
      end = index;
      break;
    }
  }
  if (end < 0)
    return yield* new ProviderRuntimeFailure({ cause: new Error(sourceText("error.provider.archiveUnreadable")) });
  const count = tail.readUInt16LE(end + 10);
  const directoryBytes = tail.readUInt32LE(end + 12);
  const directoryOffset = tail.readUInt32LE(end + 16);
  if (count === 0xffff || directoryBytes === 0xffffffff || directoryOffset === 0xffffffff) {
    return yield* new ProviderRuntimeFailure({ cause: new Error(sourceText("error.provider.archiveUnreadable")) });
  }
  const directory = yield* readAtEffect(handle, directoryOffset, directoryBytes);
  const entries: ZipEntry[] = [];
  let offset = 0;
  for (let index = 0; index < count; index += 1) {
    if (offset + 46 > directory.length || directory.readUInt32LE(offset) !== 0x02014b50) {
      return yield* new ProviderRuntimeFailure({ cause: new Error(sourceText("error.provider.archiveUnreadable")) });
    }
    const madeBy = directory.readUInt16LE(offset + 4) >> 8;
    const flags = directory.readUInt16LE(offset + 8);
    const nameBytes = directory.readUInt16LE(offset + 28);
    const extraBytes = directory.readUInt16LE(offset + 30);
    const commentBytes = directory.readUInt16LE(offset + 32);
    const unixMode = directory.readUInt32LE(offset + 38) >>> 16;
    const entry: ZipEntry = {
      name: directory.toString("utf8", offset + 46, offset + 46 + nameBytes),
      method: directory.readUInt16LE(offset + 10),
      crc: directory.readUInt32LE(offset + 16),
      compressedBytes: directory.readUInt32LE(offset + 20),
      bytes: directory.readUInt32LE(offset + 24),
      localHeaderOffset: directory.readUInt32LE(offset + 42),
    };
    offset += 46 + nameBytes + extraBytes + commentBytes;
    // Unix is host 3; its mode is the high half of the external attributes. A link or device is
    // refused here, as `assertSafeArchive` refuses one in a tarball. A name that ends in `/` is a
    // folder, and holds no data.
    const folder = entry.name.endsWith("/");
    const type = folder ? ZIP_UNIX_DIRECTORY : ZIP_UNIX_REGULAR_FILE;
    if (madeBy === 3 && unixMode !== 0 && (unixMode & ZIP_UNIX_TYPE_MASK) !== type) {
      return yield* new ProviderRuntimeFailure({ cause: new Error(sourceText("error.provider.archiveSpecialFile")) });
    }
    if (folder && entry.bytes !== 0)
      return yield* new ProviderRuntimeFailure({ cause: new Error(sourceText("error.provider.archiveUnreadable")) });
    if ((flags & 1) !== 0 || ![0, 8].includes(entry.method) || entry.compressedBytes === 0xffffffff) {
      return yield* new ProviderRuntimeFailure({ cause: new Error(sourceText("error.provider.archiveUnreadable")) });
    }
    if (!accepts(entry.name) || entries.some((other) => other.name === entry.name))
      return yield* new ProviderRuntimeFailure({ cause: new Error(message) });
    entries.push(entry);
  }
  return entries;
});

const zipDataOffsetEffect = Effect.fn("ProviderArchive.zipDataOffset")(function* (
  handle: FileHandle,
  entry: ZipEntry,
): Effect.fn.Return<number, ProviderRuntimeFailure> {
  const header = yield* readAtEffect(handle, entry.localHeaderOffset, 30);
  if (header.readUInt32LE(0) !== 0x04034b50)
    return yield* new ProviderRuntimeFailure({ cause: new Error(sourceText("error.provider.archiveUnreadable")) });
  return entry.localHeaderOffset + 30 + header.readUInt16LE(26) + header.readUInt16LE(28);
});

const extractZipEntryEffect = Effect.fn("ProviderArchive.extractZipEntry")(function* (
  archive: string,
  dataStart: number,
  entry: ZipEntry,
  path: string,
): Effect.fn.Return<void, ProviderRuntimeFailure> {
  let crc = 0;
  let bytes = 0;
  const check = new Transform({
    transform(chunk: Buffer, _encoding, callback) {
      crc = crc32(chunk, crc);
      bytes += chunk.length;
      callback(bytes > entry.bytes ? new Error(sourceText("error.provider.archiveUnreadable")) : null, chunk);
    },
  });
  if (entry.compressedBytes === 0) {
    yield* runtimeIO(() => writeFile(path, "", { flag: "wx" }));
  } else {
    const input = createReadStream(archive, { start: dataStart, end: dataStart + entry.compressedBytes - 1 });
    const output = createWriteStream(path, { flags: "wx" });
    yield* runtimeIO(() =>
      entry.method === 8 ? pipeline(input, createInflateRaw(), check, output) : pipeline(input, check, output),
    );
  }
  if (bytes !== entry.bytes || crc >>> 0 !== entry.crc)
    return yield* new ProviderRuntimeFailure({ cause: new Error(sourceText("error.provider.archiveUnreadable")) });
});

const readAtEffect = Effect.fn("ProviderArchive.readAt")(function* (
  handle: FileHandle,
  position: number,
  length: number,
): Effect.fn.Return<Buffer, ProviderRuntimeFailure> {
  const buffer = Buffer.alloc(length);
  const { bytesRead } = yield* runtimeIO(() => handle.read(buffer, 0, length, position));
  if (bytesRead !== length)
    return yield* new ProviderRuntimeFailure({ cause: new Error(sourceText("error.provider.archiveUnreadable")) });
  return buffer;
});
export const rejectNonRegularFiles = Effect.fn("ProviderArchive.rejectNonRegularFiles")(function* (
  root: string,
): Effect.fn.Return<void, ProviderRuntimeFailure> {
  const entries = yield* runtimeIO(() => readdir(root, { withFileTypes: true }));
  yield* Effect.forEach(
    entries,
    (entry) =>
      Effect.gen(function* () {
        const path = join(root, entry.name);
        if (entry.isSymbolicLink() || (!entry.isFile() && !entry.isDirectory()))
          return yield* new ProviderRuntimeFailure({
            cause: new Error(sourceText("error.provider.runtimeSpecialFile")),
          });
        if (entry.isDirectory()) yield* rejectNonRegularFiles(path);
      }),
    { concurrency: "unbounded", discard: true },
  );
});
