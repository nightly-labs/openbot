import { randomUUID } from "node:crypto";
import { readFile, realpath, stat } from "node:fs/promises";
import { extname, isAbsolute, join, relative, sep } from "node:path";
import { CHAT_VISUAL_PAGE_LIMIT, isChatVisualMimeType } from "@openbot/contracts/chat-visual";
import { ATTACHMENT_LIMITS } from "@openbot/contracts/input-limits";
import { isFilePreviewPageUrl } from "@openbot/contracts/ipc";
import { attachmentDocumentHeaders, chatVisualResponse } from "./chat-visual-protocol";

const FILE_PREVIEW_PAGE_CAPACITY = 8;

/**
 * The files next to an HTML file that its page can load, such as `images/01.png` in a review page
 * (#11088). Scripts are not here: a page can read the values of a script that it loads.
 */
const PAGE_ASSET_TYPES: Readonly<Record<string, string>> = {
  ".avif": "image/avif",
  ".css": "text/css; charset=utf-8",
  ".gif": "image/gif",
  ".jpeg": "image/jpeg",
  ".jpg": "image/jpeg",
  ".png": "image/png",
  ".svg": "image/svg+xml",
  ".webp": "image/webp",
};

interface FilePreviewPage {
  bytes: Uint8Array;
  /** The real folder of the HTML file. The page can load the image and style files under it. */
  folder?: string;
}

/** A relative path with no hidden, parent or empty segment, and a file type that a page can load. */
function pageAssetType(path: string): string | undefined {
  if (/[\0\\:]/u.test(path) || path.split("/").some((segment) => !segment || segment.startsWith("."))) return undefined;
  return PAGE_ASSET_TYPES[extname(path).toLowerCase()];
}

/**
 * HTML bytes that the app has already read through an authorized file preview. An opaque address
 * lets the existing visual-page protocol serve them without accepting a filesystem path from a
 * frame. Nothing is written to disk. The server-owned preview state releases its page when
 * replaced, closed or disposed. Main clears all pages when the renderer is replaced or lost.
 * At most eight pages (64 MB) can be held; an accepted page stays available until release or clear.
 *
 * A page of a local file also gets its folder: `<address>/<relative path>` serves an image or a
 * style file under that folder, while the page is held. The path is checked again after links are
 * followed, so a link cannot reach a file outside the folder or a hidden file.
 */
export class FilePreviewPages {
  readonly #pages = new Map<string, FilePreviewPage>();
  #generation = 0;

  constructor(private readonly capacity = FILE_PREVIEW_PAGE_CAPACITY) {}

  get generation(): number {
    return this.#generation;
  }

  clear(): void {
    this.#generation += 1;
    this.#pages.clear();
  }

  add(mimeType: string, bytes: Uint8Array, generation: number, folder?: string): string | undefined {
    if (
      generation !== this.#generation ||
      !isChatVisualMimeType(mimeType) ||
      bytes.byteLength > CHAT_VISUAL_PAGE_LIMIT ||
      this.#pages.size >= this.capacity
    )
      return undefined;
    const address = `openbot-visual://preview/${randomUUID()}`;
    this.#pages.set(address, { bytes: bytes.slice(), ...(folder ? { folder } : {}) });
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
    this.#pages.delete(address);
  }

  async response(request: Request): Promise<Response> {
    const url = new URL(request.url);
    const page = request.method === "GET" ? this.get(url) : undefined;
    if (page) {
      const html = new TextDecoder().decode(page);
      // Relative addresses resolve under the page's own address, where its folder is served. A
      // page that sets its own base keeps it.
      const base =
        this.#pages.get(`${url.protocol}//${url.host}${url.pathname}`)?.folder && !/<base\b/iu.test(html)
          ? `<base href="${url.protocol}//${url.host}${url.pathname}/">`
          : undefined;
      return chatVisualResponse(page, base ? { head: base } : {});
    }
    const asset = request.method === "GET" ? await this.#asset(url) : undefined;
    return asset ?? new Response("Not found", { status: 404 });
  }

  async #asset(url: URL): Promise<Response | undefined> {
    const match = /^\/([^/]+)\/(.+)$/u.exec(url.pathname);
    if (url.username || url.password || !match?.[1] || !match[2]) return undefined;
    const folder = this.#pages.get(`${url.protocol}//${url.host}/${match[1]}`)?.folder;
    if (!folder) return undefined;
    let path: string;
    try {
      path = decodeURIComponent(match[2]);
    } catch {
      return undefined;
    }
    if (!pageAssetType(path)) return undefined;
    try {
      const file = await realpath(join(folder, ...path.split("/")));
      const inside = relative(folder, file);
      if (!inside || isAbsolute(inside) || inside.startsWith("..")) return undefined;
      const type = pageAssetType(inside.split(sep).join("/"));
      const info = await stat(file);
      if (!type || !info.isFile() || info.size > ATTACHMENT_LIMITS.fileBytes) return undefined;
      return new Response(new Uint8Array(await readFile(file)), {
        headers: {
          "Content-Type": type,
          "Cache-Control": "no-store",
          "X-Content-Type-Options": "nosniff",
          ...attachmentDocumentHeaders(type),
        },
      });
    } catch {
      return undefined;
    }
  }
}

export const filePreviewPages = new FilePreviewPages();
