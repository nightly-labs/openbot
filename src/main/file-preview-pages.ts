import { randomUUID } from "node:crypto";
import { isChatVisualMimeType } from "@openbot/contracts/chat-visual";
import { isFilePreviewPageUrl } from "@openbot/contracts/ipc";
import { CHAT_VISUAL_PAGE_LIMIT, chatVisualResponse } from "./chat-visual-protocol";

const FILE_PREVIEW_PAGE_CAPACITY = 8;

/**
 * HTML bytes that the app has already read through an authorized file preview. An opaque address
 * lets the existing visual-page protocol serve them without accepting a filesystem path from a
 * frame. Nothing is written to disk. The server-owned preview state releases its page when
 * replaced, closed or disposed.
 * At most eight pages (64 MB) can be held; an accepted page stays available until its release.
 */
export class FilePreviewPages {
  readonly #pages = new Map<string, Uint8Array>();

  constructor(private readonly capacity = FILE_PREVIEW_PAGE_CAPACITY) {}

  add(mimeType: string, bytes: Uint8Array): string | undefined {
    if (
      !isChatVisualMimeType(mimeType) ||
      bytes.byteLength > CHAT_VISUAL_PAGE_LIMIT ||
      this.#pages.size >= this.capacity
    )
      return undefined;
    const address = `openbot-visual://preview/${randomUUID()}`;
    this.#pages.set(address, bytes.slice());
    return address;
  }

  get(url: URL): Uint8Array | undefined {
    // The frame theme is in the fragment; a query must never become a file lookup.
    if (url.username || url.password || url.search) return undefined;
    const address = `${url.protocol}//${url.host}${url.pathname}`;
    if (!isFilePreviewPageUrl(address)) return undefined;
    return this.#pages.get(address);
  }

  release(address: string): void {
    this.#pages.delete(address);
  }

  response(request: Request): Response {
    const bytes = request.method === "GET" ? this.get(new URL(request.url)) : undefined;
    return bytes ? chatVisualResponse(bytes) : new Response("Not found", { status: 404 });
  }
}

export const filePreviewPages = new FilePreviewPages();
