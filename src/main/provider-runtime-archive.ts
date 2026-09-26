import { execFile } from "node:child_process";
import { createReadStream, createWriteStream } from "node:fs";
import { type FileHandle, open, readdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { Transform } from "node:stream";
import { pipeline } from "node:stream/promises";
import { promisify } from "node:util";
import { crc32, createInflateRaw } from "node:zlib";
import { sourceText } from "@openbot/i18n/source";

const execFileAsync = promisify(execFile);

const MAX_ARCHIVE_LIST_BYTES = 16 * 1024 * 1024;

/**
 * The archive checks a provider runtime shares. They are here rather than in the manager because
 * the per-provider staging steps in `provider-runtime-descriptors.ts` are what call them, and a
 * provider must not be able to skip them by writing its own extraction.
 *
 * `allowedRoots` is the set of top-level names the archive may contain: an archive that unpacks
 * anything else is rejected before extraction, so a changed upstream layout is a loud failure
 * rather than a file written where OpenBot did not expect one.
 */
export async function assertSafeArchive(path: string, allowedRoots: readonly string[], message: string): Promise<void> {
  const [{ stdout: namesValue }, { stdout: detailsValue }] = await Promise.all([
    execFileAsync("tar", ["-tzf", path], { encoding: "utf8", maxBuffer: MAX_ARCHIVE_LIST_BYTES }),
    execFileAsync("tar", ["-tvzf", path], { encoding: "utf8", maxBuffer: MAX_ARCHIVE_LIST_BYTES }),
  ]);
  const names = namesValue.split(/\r?\n/u).filter(Boolean);
  const details = detailsValue.split(/\r?\n/u).filter(Boolean);
  if (details.some((line) => !["-", "d"].includes(line.trimStart().charAt(0)))) {
    throw new Error(sourceText("error.provider.archiveSpecialFile"));
  }
  for (const name of names) {
    if (name.includes("\0") || name.includes("\\")) throw new Error(sourceText("error.provider.archiveUnsafePath"));
    const normalized = name.replace(/\/+$/u, "");
    const parts = normalized.split("/");
    if (
      !normalized ||
      normalized.startsWith("/") ||
      /^[A-Za-z]:/u.test(normalized) ||
      parts.some((part) => !part || part === "." || part === "..")
    ) {
      throw new Error(sourceText("error.provider.archiveUnsafePath"));
    }
    if (!allowedRoots.includes(parts[0] ?? "")) throw new Error(message);
  }
}

export async function extractArchive(archive: string, destination: string): Promise<void> {
  await execFileAsync("tar", ["-xzf", archive, "-C", destination, "--no-same-owner"], {
    encoding: "utf8",
    maxBuffer: MAX_ARCHIVE_LIST_BYTES,
  });
}

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

/**
 * Unpacks the named files of a flat zip archive into `destination`.
 *
 * `tar` cannot do this on every target: GNU tar on Linux reads no zip. The central directory is read
 * first, and the archive is rejected before one byte is written when it has a name outside `names`,
 * a directory, a link, an encrypted entry, a Zip64 size or a second copy of a name. Each file is
 * inflated by zlib as a stream, so a 1 GB program does not have to fit in memory, and its CRC-32 and
 * size must match the directory.
 */
export async function extractZipFiles(
  archive: string,
  destination: string,
  names: readonly string[],
  message: string,
): Promise<void> {
  const handle = await open(archive, "r");
  let entries: ZipEntry[];
  try {
    entries = await readZipDirectory(handle, names, message);
    for (const entry of entries) {
      const dataStart = await zipDataOffset(handle, entry);
      await extractZipEntry(archive, dataStart, entry, join(destination, entry.name));
    }
  } finally {
    await handle.close();
  }
}

async function readZipDirectory(handle: FileHandle, names: readonly string[], message: string): Promise<ZipEntry[]> {
  const { size } = await handle.stat();
  const tailBytes = Math.min(size, ZIP_END_MAX_BYTES);
  const tail = await readAt(handle, size - tailBytes, tailBytes);
  let end = -1;
  for (let index = tail.length - 22; index >= 0; index -= 1) {
    if (tail.readUInt32LE(index) === 0x06054b50) {
      end = index;
      break;
    }
  }
  if (end < 0) throw new Error(sourceText("error.provider.archiveUnreadable"));
  const count = tail.readUInt16LE(end + 10);
  const directoryBytes = tail.readUInt32LE(end + 12);
  const directoryOffset = tail.readUInt32LE(end + 16);
  if (count === 0xffff || directoryBytes === 0xffffffff || directoryOffset === 0xffffffff) {
    throw new Error(sourceText("error.provider.archiveUnreadable"));
  }
  const directory = await readAt(handle, directoryOffset, directoryBytes);
  const entries: ZipEntry[] = [];
  let offset = 0;
  for (let index = 0; index < count; index += 1) {
    if (offset + 46 > directory.length || directory.readUInt32LE(offset) !== 0x02014b50) {
      throw new Error(sourceText("error.provider.archiveUnreadable"));
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
    // refused here, as `assertSafeArchive` refuses one in a tarball.
    if (madeBy === 3 && unixMode !== 0 && (unixMode & ZIP_UNIX_TYPE_MASK) !== ZIP_UNIX_REGULAR_FILE) {
      throw new Error(sourceText("error.provider.archiveSpecialFile"));
    }
    if ((flags & 1) !== 0 || ![0, 8].includes(entry.method) || entry.compressedBytes === 0xffffffff) {
      throw new Error(sourceText("error.provider.archiveUnreadable"));
    }
    if (!names.includes(entry.name) || entries.some((other) => other.name === entry.name)) throw new Error(message);
    entries.push(entry);
  }
  if (entries.length !== names.length) throw new Error(message);
  return entries;
}

async function zipDataOffset(handle: FileHandle, entry: ZipEntry): Promise<number> {
  const header = await readAt(handle, entry.localHeaderOffset, 30);
  if (header.readUInt32LE(0) !== 0x04034b50) throw new Error(sourceText("error.provider.archiveUnreadable"));
  return entry.localHeaderOffset + 30 + header.readUInt16LE(26) + header.readUInt16LE(28);
}

async function extractZipEntry(archive: string, dataStart: number, entry: ZipEntry, path: string): Promise<void> {
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
    await writeFile(path, "", { flag: "wx" });
  } else {
    const input = createReadStream(archive, { start: dataStart, end: dataStart + entry.compressedBytes - 1 });
    const output = createWriteStream(path, { flags: "wx" });
    await (entry.method === 8 ? pipeline(input, createInflateRaw(), check, output) : pipeline(input, check, output));
  }
  if (bytes !== entry.bytes || crc >>> 0 !== entry.crc) throw new Error(sourceText("error.provider.archiveUnreadable"));
}

async function readAt(handle: FileHandle, position: number, length: number): Promise<Buffer> {
  const buffer = Buffer.alloc(length);
  const { bytesRead } = await handle.read(buffer, 0, length, position);
  if (bytesRead !== length) throw new Error(sourceText("error.provider.archiveUnreadable"));
  return buffer;
}

export async function rejectNonRegularFiles(root: string): Promise<void> {
  const entries = await readdir(root, { withFileTypes: true });
  await Promise.all(
    entries.map(async (entry) => {
      const path = join(root, entry.name);
      if (entry.isSymbolicLink() || (!entry.isFile() && !entry.isDirectory())) {
        throw new Error(sourceText("error.provider.runtimeSpecialFile"));
      }
      if (entry.isDirectory()) await rejectNonRegularFiles(path);
    }),
  );
}
