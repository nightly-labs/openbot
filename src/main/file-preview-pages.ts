import { randomUUID } from "node:crypto";
import { realpath } from "node:fs/promises";
import { extname, join, relative, sep } from "node:path";
import { CHAT_VISUAL_PAGE_LIMIT, isChatVisualMimeType } from "@openbot/contracts/chat-visual";
import { ATTACHMENT_LIMITS } from "@openbot/contracts/input-limits";
import { isFilePreviewPageUrl } from "@openbot/contracts/ipc";
import { runCauseEffect } from "../backend/effect-boundary";
import { isPathInside } from "../backend/path-containment";
import { attachmentDocumentHeaders, chatVisualResponse, staticChatVisualOptions } from "./chat-visual-protocol";
import { fileResponse } from "./file-response";

const FILE_PREVIEW_PAGE_CAPACITY = 8;

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
  pdf: boolean;
  folder?: string;
}

function isPdfMimeType(mimeType: string): boolean {
  return (mimeType.split(";", 1)[0] ?? "").trim().toLowerCase() === "application/pdf";
}

function pageByteLimit(mimeType: string): number {
  if (isPdfMimeType(mimeType)) return ATTACHMENT_LIMITS.fileBytes;
  return isChatVisualMimeType(mimeType) ? CHAT_VISUAL_PAGE_LIMIT : -1;
}

function pdfResponse(bytes: Uint8Array): Response {
  return new Response(new Uint8Array(bytes), {
    headers: {
      "Content-Type": "application/pdf",
      "Cache-Control": "no-store",
      "X-Content-Type-Options": "nosniff",
    },
  });
}

function pageAssetType(path: string): string | undefined {
  if (/[\0\\:]/u.test(path) || path.split("/").some((segment) => !segment || segment.startsWith("."))) return undefined;
  return PAGE_ASSET_TYPES[extname(path).toLowerCase()];
}

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
      bytes.byteLength > pageByteLimit(mimeType) ||
      this.#pages.size >= this.capacity
    )
      return undefined;
    const address = `openbot-visual://preview/${randomUUID()}`;
    this.#pages.set(address, { bytes: bytes.slice(), pdf: isPdfMimeType(mimeType), ...(folder ? { folder } : {}) });
    return address;
  }

  get(url: URL): Uint8Array | undefined {
    return this.#page(url)?.bytes;
  }

  #page(url: URL): FilePreviewPage | undefined {
    if (url.username || url.password || (url.search && !staticChatVisualOptions(url))) return undefined;
    const address = `${url.protocol}//${url.host}${url.pathname}`;
    if (!isFilePreviewPageUrl(address)) return undefined;
    return this.#pages.get(address);
  }

  release(address: string): void {
    this.#pages.delete(address);
  }

  async response(request: Request): Promise<Response> {
    const url = new URL(request.url);
    const page = request.method === "GET" ? this.#page(url) : undefined;
    if (page?.pdf) return pdfResponse(page.bytes);
    if (page) {
      const base =
        page.folder && !/<base\b[^>]*\bhref\s*=/iu.test(new TextDecoder().decode(page.bytes))
          ? `<base href="${url.protocol}//${url.host}${url.pathname}/">`
          : undefined;
      return chatVisualResponse(page.bytes, base ? { head: base } : {}, staticChatVisualOptions(url));
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
      const type = inside && isPathInside(folder, file) ? pageAssetType(inside.split(sep).join("/")) : undefined;
      if (!type) return undefined;
      return await runCauseEffect(
        fileResponse(file, {
          "Content-Type": type,
          "Cache-Control": "no-store",
          "X-Content-Type-Options": "nosniff",
          ...attachmentDocumentHeaders(type),
        }),
      );
    } catch {
      return undefined;
    }
  }
}

export const filePreviewPages = new FilePreviewPages();
