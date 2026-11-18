import { createHash, randomUUID } from "node:crypto";
import { mkdir, open, readdir, readFile, rename, rm, stat, utimes, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { ATTACHMENT_LIMITS } from "@openbot/contracts/input-limits";
import {
  ATTACHMENT_PREVIEW_EDGES,
  type AttachmentPreviewSize,
} from "@openbot/contracts/team-protocol/attachment-previews-v1";
import { Effect, Schema, Semaphore } from "effect";

// The smaller copies of picture attachments that this host sends to a phone (`attachment-previews-v1`),
// kept on disk.
//
// A copy is made in this process with a synchronous decode: a 24-megapixel photo takes about 0.3 s.
// A phone that opens a library of 200 photos asks for 200 copies, and each open asks again. So one
// decode runs at a time, and each copy is saved in the user data folder of this computer, where the
// attachments already are. The name of a copy comes from the attachment id, the size, and the path,
// length and change time of the file, so a copy is never sent for a different file. The oldest copies
// go when the folder is over its budget. A failure of the folder never fails a request: the copy is
// then made in memory only.

/** The disk space that the copies can use. The oldest copies go first. */
const PREVIEW_CACHE_BYTES = 500 * 1024 * 1024;
/** After a trim, the copies use this part of the budget, so the next writes do not trim again. */
const PREVIEW_CACHE_TRIM_TO = 0.9;
const EXTENSIONS = { "image/jpeg": "jpg", "image/png": "png" } as const;
const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];

export interface AttachmentPreviewFile {
  bytes: Uint8Array;
  mimeType: keyof typeof EXTENSIONS;
}

/** Makes a copy no larger than `maxEdge`; `agent-image-fit.ts` has the Electron implementation. */
export type MakeAttachmentPreview = (
  bytes: Uint8Array,
  maxEdge: number,
) => AttachmentPreviewFile | "unsupported" | "tooLarge";

/** The attachment file could not be read. The cause stays private. */
export class AttachmentPreviewReadFailure extends Schema.TaggedError<AttachmentPreviewReadFailure>()(
  "AttachmentPreviewReadFailure",
  { cause: Schema.Defect() },
) {}

interface CachedFile {
  name: string;
  size: number;
  time: number;
}

export class AttachmentPreviews {
  readonly #root: string;
  readonly #make: MakeAttachmentPreview;
  readonly #budget: number;
  // One decode at a time: it blocks this process while it runs.
  readonly #decodes = Semaphore.makeUnsafe(1);
  // One change of the folder at a time, so a trim does not count a file that a write replaces.
  readonly #changes = Semaphore.makeUnsafe(1);
  /** The bytes of the copies on disk, counted at the first write. */
  #bytes: number | null = null;

  constructor(options: { root: string; make: MakeAttachmentPreview; budgetBytes?: number }) {
    this.#root = options.root;
    this.#make = options.make;
    this.#budget = options.budgetBytes ?? PREVIEW_CACHE_BYTES;
  }

  /**
   * The copy of one attachment file, or null when the file is not a JPEG or PNG that this host can
   * decode. The caller resolved the attachment with the access of `GET /v1/attachments/:id`.
   */
  readonly preview = Effect.fn("AttachmentPreviews.preview")(function* (
    this: AttachmentPreviews,
    attachment: { id: string; path: string },
    size: AttachmentPreviewSize,
  ) {
    const source = yield* Effect.tryPromise({
      try: () => stat(attachment.path),
      catch: (cause) => new AttachmentPreviewReadFailure({ cause }),
    });
    if (!source.isFile() || source.size > ATTACHMENT_LIMITS.fileBytes) return null;
    if (!(yield* readsAsPicture(attachment.path))) return null;
    const key = cacheKey(attachment, size, source.size, source.mtimeMs);
    const cached = yield* this.#read(key);
    if (cached) return cached;
    return yield* this.#decodes.withPermit(
      Effect.gen({ self: this }, function* () {
        // Another request for the same copy can have made it while this one waited.
        const made = yield* this.#read(key);
        if (made) return made;
        const bytes = yield* Effect.tryPromise({
          try: () => readFile(attachment.path),
          catch: (cause) => new AttachmentPreviewReadFailure({ cause }),
        });
        const preview = this.#make(bytes, ATTACHMENT_PREVIEW_EDGES[size]);
        if (typeof preview === "string") return null;
        // A file that changed during the read is sent, but not saved under the name of the old one.
        const after = yield* Effect.tryPromise(() => stat(attachment.path)).pipe(Effect.orElseSucceed(() => null));
        if (after?.size === source.size && after.mtimeMs === source.mtimeMs) yield* this.#write(key, preview);
        return preview;
      }),
    );
  }).bind(this);

  /** The saved copy, or null. A copy that cannot be read is a miss. */
  #read(key: string): Effect.Effect<AttachmentPreviewFile | null> {
    return Effect.tryPromise(async () => {
      for (const mimeType of ["image/jpeg", "image/png"] as const) {
        const path = join(this.#root, `${key}.${EXTENSIONS[mimeType]}`);
        const bytes = await readFile(path).catch(() => null);
        if (!bytes?.length) continue;
        // The change time orders the trim, so a copy that is read stays longer.
        const now = new Date();
        await utimes(path, now, now).catch(() => undefined);
        return { bytes: new Uint8Array(bytes), mimeType };
      }
      return null;
    }).pipe(Effect.orElseSucceed(() => null));
  }

  /** Saves a copy through a temporary file, then trims the folder to the budget. A failure saves nothing. */
  #write(key: string, preview: AttachmentPreviewFile): Effect.Effect<void> {
    return this.#changes.withPermit(
      Effect.tryPromise(async () => {
        await mkdir(this.#root, { recursive: true });
        if (this.#bytes === null) this.#bytes = (await this.#files()).reduce((total, file) => total + file.size, 0);
        const name = `${key}.${EXTENSIONS[preview.mimeType]}`;
        const temporary = join(this.#root, `${randomUUID()}.tmp`);
        try {
          await writeFile(temporary, preview.bytes);
          await rename(temporary, join(this.#root, name));
        } finally {
          await rm(temporary, { force: true });
        }
        this.#bytes += preview.bytes.byteLength;
        if (this.#bytes > this.#budget) await this.#trim(name);
      }).pipe(
        // The count is not known after a failure; the next write counts the folder again.
        Effect.catch(() =>
          Effect.sync(() => {
            this.#bytes = null;
          }),
        ),
      ),
    );
  }

  /**
   * Deletes the oldest copies until the folder uses `PREVIEW_CACHE_TRIM_TO` of the budget. The copy that
   * was just written stays, also when another copy has the same change time.
   */
  async #trim(written: string): Promise<void> {
    const files = (await this.#files()).sort((left, right) => left.time - right.time);
    let bytes = files.reduce((total, file) => total + file.size, 0);
    const target = this.#budget * PREVIEW_CACHE_TRIM_TO;
    for (const file of files) {
      if (bytes <= target) break;
      if (file.name === written) continue;
      await rm(join(this.#root, file.name), { force: true });
      bytes -= file.size;
    }
    this.#bytes = bytes;
  }

  /** Each file in the folder. A temporary file left by a stopped write is deleted. */
  async #files(): Promise<CachedFile[]> {
    const files: CachedFile[] = [];
    for (const name of await readdir(this.#root)) {
      const path = join(this.#root, name);
      if (name.endsWith(".tmp")) {
        await rm(path, { force: true });
        continue;
      }
      const file = await stat(path).catch(() => null);
      if (file?.isFile()) files.push({ name, size: file.size, time: file.mtimeMs });
    }
    return files;
  }
}

function cacheKey(attachment: { id: string; path: string }, size: string, bytes: number, time: number): string {
  return createHash("sha256")
    .update(JSON.stringify([attachment.id, size, attachment.path, bytes, time]))
    .digest("hex")
    .slice(0, 40);
}

/**
 * True when the file starts as a JPEG or a PNG. Only such a file is read whole: a video can be 100 MB.
 * The maker checks the whole file again.
 */
function readsAsPicture(path: string): Effect.Effect<boolean, AttachmentPreviewReadFailure> {
  return Effect.tryPromise({
    try: async () => {
      const file = await open(path, "r");
      try {
        const head = new Uint8Array(PNG_SIGNATURE.length);
        const { bytesRead } = await file.read(head, 0, head.length, 0);
        if (bytesRead >= 2 && head[0] === 0xff && head[1] === 0xd8) return true;
        return bytesRead === head.length && PNG_SIGNATURE.every((byte, index) => head[index] === byte);
      } finally {
        await file.close();
      }
    },
    catch: (cause) => new AttachmentPreviewReadFailure({ cause }),
  });
}
