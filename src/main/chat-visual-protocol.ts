import {
  CHAT_VISUAL_FRAME_SANDBOX,
  CHAT_VISUAL_PAGE_LIMIT,
  type ChatVisualDocumentOptions,
  chatVisualDocument,
} from "@openbot/contracts/chat-visual";
import { isTrustedRendererUrl } from "./trusted-renderer";

const DOCUMENT_MIME_TYPES = new Set(["text/html", "application/xhtml+xml", "image/svg+xml"]);

function baseMimeType(mimeType: string): string {
  return (mimeType.split(";", 1)[0] ?? "").trim().toLowerCase();
}

export function chatVisualResponse(bytes: Uint8Array, options: ChatVisualDocumentOptions = {}): Response {
  if (bytes.byteLength > CHAT_VISUAL_PAGE_LIMIT) return new Response("Not found", { status: 404 });
  return new Response(chatVisualDocument(new TextDecoder().decode(bytes), options), {
    headers: {
      "Content-Type": "text/html; charset=utf-8",
      "Content-Security-Policy": `sandbox ${CHAT_VISUAL_FRAME_SANDBOX}`,
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
