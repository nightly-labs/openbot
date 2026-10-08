import { randomUUID } from "node:crypto";
import { isChatVisualMimeType } from "@openbot/contracts/chat-visual";
import { isFilePreviewPageUrl } from "@openbot/contracts/ipc";
import { CHAT_VISUAL_PAGE_LIMIT } from "./chat-visual-protocol";

/**
 * HTML bytes that the app has already read through an authorized file preview. An opaque address
 * lets the existing visual-page protocol serve them without accepting a filesystem path from a
 * frame. Nothing is written to disk. Keep at most eight pages (64 MB), evicting the least recently
 * used page first.
 */
export class FilePreviewPages {
  readonly #pages = new Map<string, Uint8Array>();

  constructor(private readonly capacity = 8) {}

  add(mimeType: string, bytes: Uint8Array): string | undefined {
    if (!isChatVisualMimeType(mimeType) || bytes.byteLength > CHAT_VISUAL_PAGE_LIMIT) return undefined;
    const address = `openbot-visual://preview/${randomUUID()}`;
    this.#pages.set(address, bytes.slice());
    while (this.#pages.size > this.capacity) {
      const oldest = this.#pages.keys().next().value;
      if (oldest === undefined) break;
      this.#pages.delete(oldest);
    }
    return address;
  }

  get(url: URL): Uint8Array | undefined {
    // The frame theme is in the fragment; a query must never become a file lookup.
    if (url.username || url.password || url.search) return undefined;
    const address = `${url.protocol}//${url.host}${url.pathname}`;
    if (!isFilePreviewPageUrl(address)) return undefined;
    const bytes = this.#pages.get(address);
    if (bytes) {
      this.#pages.delete(address);
      this.#pages.set(address, bytes);
    }
    return bytes;
  }
}

export const filePreviewPages = new FilePreviewPages();
