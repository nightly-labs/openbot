import { randomUUID } from "node:crypto";
import { readFile, realpath, stat } from "node:fs/promises";
import { CHAT_VISUAL_PAGE_LIMIT, isChatVisualMimeType } from "@openbot/contracts/chat-visual";
import { ATTACHMENT_LIMITS } from "@openbot/contracts/input-limits";
import { isFilePreviewPageUrl } from "@openbot/contracts/ipc";
import { attachmentDocumentHeaders, chatVisualResponse } from "./chat-visual-protocol";

const FILE_PREVIEW_PAGE_CAPACITY = 8;
const FILE_PREVIEW_IMAGE_CAPACITY = 2_048;
const IMAGE_ADDRESS =
  /^openbot-visual:\/\/preview-image\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/u;

/** An image file that main found in the folder of a page, by its real path. */
interface PageImage {
  path: string;
  mimeType: string;
}

function notFound(): Response {
  return new Response("Not found", { status: 404 });
}

/**
 * HTML bytes that the app has already read through an authorized file preview. An opaque address
 * lets the existing visual-page protocol serve them without accepting a filesystem path from a
 * frame. Nothing is written to disk. The server-owned preview state releases its page when
 * replaced, closed or disposed. Main clears all pages when the renderer is replaced or lost.
 * At most eight pages (64 MB) can be held; an accepted page stays available until release or clear.
 *
 * A page can also have images from its own folder, which main found before it added the page. Each
 * has its own random address, and it goes with its page. The page has an opaque origin, so an image
 * from this address is from another origin: the page shows it, but its scripts cannot read it.
 */
export class FilePreviewPages {
  readonly #pages = new Map<string, { bytes: Uint8Array; images: readonly string[] }>();
  readonly #images = new Map<string, PageImage>();
  #generation = 0;

  constructor(
    private readonly capacity = FILE_PREVIEW_PAGE_CAPACITY,
    private readonly imageCapacity = FILE_PREVIEW_IMAGE_CAPACITY,
  ) {}

  get generation(): number {
    return this.#generation;
  }

  clear(): void {
    this.#generation += 1;
    this.#pages.clear();
    this.#images.clear();
  }

  /** Gives an image of a page that is not added yet an address. `add` or `release` drops it. */
  addImage(path: string, mimeType: string, generation: number): string | undefined {
    if (generation !== this.#generation || this.#images.size >= this.imageCapacity) return undefined;
    const address = `openbot-visual://preview-image/${randomUUID()}`;
    this.#images.set(address, { path, mimeType });
    return address;
  }

  add(mimeType: string, bytes: Uint8Array, generation: number, images: readonly string[] = []): string | undefined {
    if (
      generation !== this.#generation ||
      !isChatVisualMimeType(mimeType) ||
      bytes.byteLength > CHAT_VISUAL_PAGE_LIMIT ||
      this.#pages.size >= this.capacity
    ) {
      for (const image of images) this.#images.delete(image);
      return undefined;
    }
    const address = `openbot-visual://preview/${randomUUID()}`;
    this.#pages.set(address, { bytes: bytes.slice(), images });
    return address;
  }

  get(url: URL): Uint8Array | undefined {
    // The frame theme is in the fragment; a query must never become a file lookup.
    if (url.username || url.password || url.search) return undefined;
    const address = `${url.protocol}//${url.host}${url.pathname}`;
    if (!isFilePreviewPageUrl(address)) return undefined;
    return this.#pages.get(address)?.bytes;
  }

  release(address: string): void {
    for (const image of this.#pages.get(address)?.images ?? [address]) this.#images.delete(image);
    this.#pages.delete(address);
  }

  response(request: Request): Response {
    const bytes = request.method === "GET" ? this.get(new URL(request.url)) : undefined;
    return bytes ? chatVisualResponse(bytes, { localFile: true }) : notFound();
  }

  /**
   * An image of a page. It has no CORS header, so a page script cannot read it. It is read again on
   * each request, and a link that replaced it after the preview gets nothing.
   */
  async imageResponse(request: Request): Promise<Response> {
    const url = new URL(request.url);
    if (request.method !== "GET" || url.username || url.password || url.search) return notFound();
    const address = `${url.protocol}//${url.host}${url.pathname}`;
    const image = IMAGE_ADDRESS.test(address) ? this.#images.get(address) : undefined;
    if (!image) return notFound();
    try {
      if ((await realpath(image.path)) !== image.path) return notFound();
      const file = await stat(image.path);
      if (!file.isFile() || file.size > ATTACHMENT_LIMITS.fileBytes) return notFound();
      return new Response(new Uint8Array(await readFile(image.path)), {
        headers: {
          "Content-Type": image.mimeType,
          "Cache-Control": "no-store",
          "X-Content-Type-Options": "nosniff",
          ...attachmentDocumentHeaders(image.mimeType),
        },
      });
    } catch {
      return notFound();
    }
  }
}

export const filePreviewPages = new FilePreviewPages();
