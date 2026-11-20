import { createHash, randomUUID } from "node:crypto";
import { mkdir, readdir, readFile, rename, rm, stat, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { ATTACHMENT_PREVIEW_EDGE } from "@openbot/contracts/team-protocol/attachment-preview-v1";
import { createOpenBotLogger, toLogValue } from "@openbot/logging";
import { Deferred, Effect, Semaphore } from "effect";
import { nativeImage } from "electron";
import { jpegFacts, PNG_SIGNATURE, upright } from "./agent-image-fit";

const PREVIEW_FORMAT = `v1-${ATTACHMENT_PREVIEW_EDGE}`;
const PREVIEW_CACHE_BYTES = 512 * 1024 * 1024;
const PREVIEW_MAX_AGE_MS = 30 * 24 * 60 * 60_000;
const PRUNE_EVERY = 64;
const PREVIEW_SOURCE_BYTES = 40 * 1024 * 1024;
const PREVIEW_SOURCE_PIXELS = 40_000_000;
const SMALL_FILE_BYTES = 256 * 1024;
const JPEG_QUALITY = 82;
const KNOWN_ENTRIES = 4096;

export interface PreviewFile {
  path: string;
  mimeType: string;
}

type Encoded = { bytes: Buffer; mimeType: "image/jpeg" | "image/png" };

const EXTENSIONS = { "image/jpeg": "jpg", "image/png": "png" } as const;
const SOURCE_MARK = "src";

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
  readonly #known = new Map<string, PreviewFile | "source">();
  readonly #pending = new Map<string, Deferred.Deferred<PreviewFile | "source">>();
  readonly #making = Semaphore.makeUnsafe(1);
  #written = 0;

  constructor(root: string) {
    this.#root = root;
  }

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

  #stored = Effect.fn("AttachmentPreviews.stored")(function* (this: AttachmentPreviews, key: string) {
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
    return found[copies.length] ? ("source" as const) : null;
  });

  #find = Effect.fn("AttachmentPreviews.find")(function* (this: AttachmentPreviews, key: string, source: PreviewFile) {
    const stored = yield* this.#stored(key);
    if (stored) return stored;
    return yield* this.#making.withPermit(this.#make(key, source));
  });

  #make = Effect.fn("AttachmentPreviews.make")(function* (this: AttachmentPreviews, key: string, source: PreviewFile) {
    const bytes = yield* Effect.tryPromise(async () => {
      const metadata = await stat(source.path);
      return metadata.size > PREVIEW_SOURCE_BYTES ? null : readFile(source.path);
    });
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

  #write = Effect.fn("AttachmentPreviews.write")(function* (this: AttachmentPreviews, path: string, bytes: Buffer) {
    const temporary = `${path}.${randomUUID()}.tmp`;
    yield* Effect.tryPromise(() => writeFile(temporary, bytes)).pipe(
      Effect.flatMap(() => Effect.tryPromise(() => rename(temporary, path))),
      Effect.onError(() => Effect.promise(() => rm(temporary, { force: true }))),
    );
    if (this.#written++ % PRUNE_EVERY === 0) yield* Effect.forkDetach(this.#prune());
  });

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
