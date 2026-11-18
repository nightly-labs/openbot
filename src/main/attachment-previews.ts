import { createHash, randomUUID } from "node:crypto";
import { mkdir, readdir, readFile, rename, rm, stat, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { ATTACHMENT_PREVIEW_EDGE } from "@openbot/contracts/team-protocol/attachment-preview-v1";
import { createOpenBotLogger, toLogValue } from "@openbot/logging";
import { Deferred, Effect } from "effect";
import { nativeImage } from "electron";
import { jpegFacts, PNG_SIGNATURE, upright } from "./agent-image-fit";

// Small copies of the image attachments of this computer, kept on disk (`attachment-preview-v1`).
//
// A card on the Workflows canvas shows a picture at a few hundred pixels, but it read the whole file:
// a generated picture is 2 to 10 MB. On a joined server each card downloaded that file from the host,
// and 12 pictures took 12 s on a 20 Mbit/s link. A copy of at most 768 px is 30 to 150 KB.
//
// An attachment id names bytes that do not change, so a copy is made once. The copies stay on this
// computer, beside its attachments. The oldest copies go when the directory is over its budget or
// older than `PREVIEW_MAX_AGE_MS`; a copy of a deleted attachment goes with them. The routes read the
// attachment before its copy, so a deleted attachment is never sent.

/** Part of each file name. A change of the copy (its size or its encoding) makes new copies. */
const PREVIEW_FORMAT = `v1-${ATTACHMENT_PREVIEW_EDGE}`;
const PREVIEW_CACHE_BYTES = 512 * 1024 * 1024;
const PREVIEW_MAX_AGE_MS = 30 * 24 * 60 * 60_000;
/** The directory is checked against its budget after this many new copies, and at the first copy. */
const PRUNE_EVERY = 64;
/** A larger file is sent as it is. Its decode would hold the main process. */
const PREVIEW_SOURCE_BYTES = 40 * 1024 * 1024;
/** 40 million pixels is about 160 MB decoded and about 0.4 s of decode. A larger picture is sent as it is. */
const PREVIEW_SOURCE_PIXELS = 40_000_000;
/**
 * A file of at most this size, with its longest side at most the preview edge, is sent as it is. A
 * larger file with no copy is not sent: a client downloads several previews at the same time, and
 * several large files would fill the send buffer of the data channel.
 */
const SMALL_FILE_BYTES = 256 * 1024;
const JPEG_QUALITY = 82;
/** The copies whose place is known, so a hit needs no disk read. */
const KNOWN_ENTRIES = 4096;

/** A file to send: the copy, or the attachment itself. */
export interface PreviewFile {
  path: string;
  mimeType: string;
}

type Encoded = { bytes: Buffer; mimeType: "image/jpeg" | "image/png" };

const EXTENSIONS = { "image/jpeg": "jpg", "image/png": "png" } as const;
/** An empty file with this extension records that the attachment itself is its preview. */
const SOURCE_MARK = "src";

/**
 * A copy of a PNG or JPEG file whose longest side is at most `edge`, upright: a browser turns a JPEG
 * by its EXIF orientation, and the copy has no EXIF data. It is a JPEG, or a PNG when the picture has
 * clear pixels. Null when the file is of another type, too large to decode, or already small, or when
 * the copy is not smaller than the file.
 */
function previewImage(bytes: Uint8Array, edge: number): Encoded | null {
  const file = Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const jpeg = file[0] === 0xff && file[1] === 0xd8;
  const png = file.length >= 24 && file.subarray(0, 8).equals(PNG_SIGNATURE);
  if (!jpeg && !png) return null;
  const facts = jpeg ? jpegFacts(file) : { orientation: 1, pixels: file.readUInt32BE(16) * file.readUInt32BE(20) };
  if (facts.pixels === 0 || facts.pixels > PREVIEW_SOURCE_PIXELS) return null;
  const source = nativeImage.createFromBuffer(file);
  if (source.isEmpty()) return null;
  const { width, height } = source.getSize();
  const scale = Math.min(1, edge / Math.max(width, height));
  if (scale === 1 && file.length <= SMALL_FILE_BYTES && facts.orientation === 1) return null;
  const resized =
    scale < 1
      ? source.resize({
          width: Math.max(1, Math.round(width * scale)),
          height: Math.max(1, Math.round(height * scale)),
          quality: "good",
        })
      : source;
  const fitted = upright(resized, facts.orientation);
  const encoded: Encoded =
    png && hasClearPixels(fitted.toBitmap())
      ? { bytes: fitted.toPNG(), mimeType: "image/png" }
      : { bytes: fitted.toJPEG(JPEG_QUALITY), mimeType: "image/jpeg" };
  return encoded.bytes.length > 0 && encoded.bytes.length < file.length ? encoded : null;
}

/** True when a pixel of the bitmap (4 bytes a pixel, alpha last) is not fully opaque. */
function hasClearPixels(bitmap: Buffer): boolean {
  for (let index = 3; index < bitmap.length; index += 4) if ((bitmap[index] ?? 255) < 255) return true;
  return false;
}

function hash(value: string): string {
  return createHash("sha256").update(value).digest("hex").slice(0, 32);
}

export class AttachmentPreviews {
  readonly #root: string;
  readonly #logger = createOpenBotLogger("attachment-previews");
  // A `Map` iterates in insertion order, so the first entry is the least recently used.
  readonly #known = new Map<string, PreviewFile | "source">();
  readonly #pending = new Map<string, Deferred.Deferred<PreviewFile | "source">>();
  #written = 0;

  constructor(root: string) {
    this.#root = root;
  }

  /**
   * The file to send as the preview of an image attachment: its copy, made now when there is none, or
   * the attachment itself when it is small. Null for a larger file with no copy. A failure is treated
   * as no copy, and the next request tries again.
   */
  readonly file = Effect.fn("AttachmentPreviews.file")(function* (
    this: AttachmentPreviews,
    attachmentId: string,
    source: PreviewFile,
  ) {
    const key = hash(`${PREVIEW_FORMAT}:${attachmentId}`);
    const known = this.#known.get(key);
    if (known) {
      this.#remember(key, known);
      return known === "source" ? yield* smallSource(source) : known;
    }
    const pending = this.#pending.get(key);
    if (pending) {
      const found = yield* Deferred.await(pending);
      return found === "source" ? yield* smallSource(source) : found;
    }
    const request = Deferred.makeUnsafe<PreviewFile | "source">();
    this.#pending.set(key, request);
    const found = yield* this.#find(key, source).pipe(
      // Only a result is kept. A read or a write that failed can work at the next request.
      Effect.tap((value) => Effect.sync(() => this.#remember(key, value))),
      Effect.catch((cause) =>
        Effect.sync(() => {
          this.#logger.warn("An attachment preview could not be made.", { cause: toLogValue(cause) });
          return "source" as const;
        }),
      ),
      Effect.onExit((exit) => Deferred.done(request, exit)),
      Effect.ensuring(Effect.sync(() => this.#pending.delete(key))),
    );
    return found === "source" ? yield* smallSource(source) : found;
  });

  #find = Effect.fn("AttachmentPreviews.find")(function* (this: AttachmentPreviews, key: string, source: PreviewFile) {
    const copies = Object.entries(EXTENSIONS).map(([mimeType, extension]) => ({
      path: join(this.#root, `${key}.${extension}`),
      mimeType,
    }));
    const mark = join(this.#root, `${key}.${SOURCE_MARK}`);
    const found = yield* Effect.all([...copies.map((copy) => exists(copy.path)), exists(mark)], {
      concurrency: "unbounded",
    });
    const copy = copies.find((_, index) => found[index]);
    if (copy) return copy;
    if (found[copies.length]) return "source" as const;
    const bytes = yield* Effect.tryPromise(async () => {
      const metadata = await stat(source.path);
      return metadata.size > PREVIEW_SOURCE_BYTES ? null : readFile(source.path);
    });
    // The decode is synchronous, as for `fitImageForAgent`: a 1024 px PNG takes about 30 ms. The
    // limits above keep it below about 0.4 s.
    const encoded = bytes ? yield* Effect.try(() => previewImage(bytes, ATTACHMENT_PREVIEW_EDGE)) : null;
    yield* Effect.tryPromise(() => mkdir(this.#root, { recursive: true }));
    if (!encoded) {
      yield* this.#write(join(this.#root, `${key}.${SOURCE_MARK}`), Buffer.alloc(0));
      return "source" as const;
    }
    const path = join(this.#root, `${key}.${EXTENSIONS[encoded.mimeType]}`);
    yield* this.#write(path, encoded.bytes);
    return { path, mimeType: encoded.mimeType };
  });

  /** Writes the file whole, through a new name, so a reader never sees a part of it. */
  #write = Effect.fn("AttachmentPreviews.write")(function* (this: AttachmentPreviews, path: string, bytes: Buffer) {
    const temporary = `${path}.${randomUUID()}.tmp`;
    yield* Effect.tryPromise(() => writeFile(temporary, bytes)).pipe(
      Effect.flatMap(() => Effect.tryPromise(() => rename(temporary, path))),
      Effect.onError(() => Effect.promise(() => rm(temporary, { force: true }))),
    );
    if (this.#written++ % PRUNE_EVERY === 0) yield* Effect.forkDetach(this.#prune());
  });

  /** Removes the copies older than the age limit, then the oldest ones until the directory is in its budget. */
  #prune = Effect.fn("AttachmentPreviews.prune")(function* (this: AttachmentPreviews) {
    const names = yield* Effect.tryPromise(() => readdir(this.#root)).pipe(Effect.catch(() => Effect.succeed([])));
    const files = [];
    for (const name of names) {
      const metadata = yield* Effect.tryPromise(() => stat(join(this.#root, name))).pipe(
        Effect.catch(() => Effect.succeed(null)),
      );
      if (metadata?.isFile()) files.push({ name, size: metadata.size, at: metadata.mtimeMs });
    }
    files.sort((left, right) => left.at - right.at);
    let total = files.reduce((sum, file) => sum + file.size, 0);
    const oldest = Date.now() - PREVIEW_MAX_AGE_MS;
    for (const file of files) {
      if (total <= PREVIEW_CACHE_BYTES && file.at >= oldest) break;
      yield* Effect.tryPromise(() => rm(join(this.#root, file.name), { force: true })).pipe(Effect.ignore);
      total -= file.size;
      this.#known.delete(file.name.replace(/\..*$/u, ""));
    }
  });

  #remember(key: string, value: PreviewFile | "source"): void {
    this.#known.delete(key);
    this.#known.set(key, value);
    for (const oldKey of this.#known.keys()) {
      if (this.#known.size <= KNOWN_ENTRIES) break;
      this.#known.delete(oldKey);
    }
  }
}

/** The attachment itself, when it is small enough to send as its own preview. */
function smallSource(source: PreviewFile): Effect.Effect<PreviewFile | null> {
  return Effect.tryPromise(() => stat(source.path)).pipe(
    Effect.map((metadata) => (metadata.isFile() && metadata.size <= SMALL_FILE_BYTES ? source : null)),
    Effect.catch(() => Effect.succeed(null)),
  );
}

function exists(path: string): Effect.Effect<boolean> {
  return Effect.tryPromise(() => stat(path)).pipe(
    Effect.map((metadata) => metadata.isFile()),
    Effect.catch(() => Effect.succeed(false)),
  );
}
