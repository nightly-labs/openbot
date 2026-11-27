import {
  CHAT_VISUAL_FRAME_SANDBOX,
  CHAT_VISUAL_PAGE_LIMIT,
  CHAT_VISUAL_STATIC_PARAMETER,
  type ChatVisualDocumentOptions,
  chatVisualDocument,
} from "@openbot/contracts/chat-visual";
import { isTrustedRendererUrl } from "./trusted-renderer";

const DOCUMENT_MIME_TYPES = new Set(["text/html", "application/xhtml+xml", "image/svg+xml"]);

function baseMimeType(mimeType: string): string {
  return (mimeType.split(";", 1)[0] ?? "").trim().toLowerCase();
}

const STATIC_PAGE_POLICY = [
  "sandbox",
  "default-src 'none'",
  "style-src 'unsafe-inline' openbot-visual:",
  "img-src data: blob: openbot-visual:",
  "font-src data: openbot-visual:",
  "media-src data: blob: openbot-visual:",
  "form-action 'none'",
].join("; ");

export function isStaticChatVisualRequest(url: URL): boolean {
  return url.searchParams.get(CHAT_VISUAL_STATIC_PARAMETER) === "1";
}

export function chatVisualResponse(
  bytes: Uint8Array,
  options: ChatVisualDocumentOptions = {},
  staticPage = false,
): Response {
  if (bytes.byteLength > CHAT_VISUAL_PAGE_LIMIT) return new Response("Not found", { status: 404 });
  const html = new TextDecoder().decode(bytes);
  return new Response(chatVisualDocument(html, staticPage ? { ...options, bootstrap: false } : options), {
    headers: {
      "Content-Type": "text/html; charset=utf-8",
      "Content-Security-Policy": staticPage ? STATIC_PAGE_POLICY : `sandbox ${CHAT_VISUAL_FRAME_SANDBOX}`,
      "Cache-Control": "no-store",
      "X-Content-Type-Options": "nosniff",
    },
  });
}

export function attachmentCorsHeaders(
  origin: string | null,
  developmentUrl = process.env.ELECTRON_RENDERER_URL,
): Record<string, string> {
  if (origin && isTrustedRendererUrl(origin, developmentUrl)) {
    return { "Access-Control-Allow-Origin": origin, Vary: "Origin" };
  }
  return { Vary: "Origin" };
}

export function attachmentDocumentHeaders(mimeType: string): Record<string, string> {
  return DOCUMENT_MIME_TYPES.has(baseMimeType(mimeType)) ? { "Content-Security-Policy": "sandbox" } : {};
}
