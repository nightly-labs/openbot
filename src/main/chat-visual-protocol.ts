import { chatVisualDocument } from "@openbot/contracts/chat-visual";
import { isTrustedRendererUrl } from "./trusted-renderer";

/**
 * Responses for the `openbot-visual` and `openbot-remote-visual` schemes, which serve an HTML
 * attachment as a visual reply page, and the CORS headers of the attachment schemes.
 *
 * A visual reply page runs the agent's scripts. Its `sandbox` policy gives it an opaque origin, so
 * it cannot read the app, its storage or another attachment, and it cannot open a window or move
 * the app window. It can load files from the network, as a web page can.
 */

/** A larger page is not served: the frame would hold all of it in memory. */
export const CHAT_VISUAL_PAGE_LIMIT = 8 * 1_024 * 1_024;

const DOCUMENT_MIME_TYPES = new Set(["text/html", "application/xhtml+xml", "image/svg+xml"]);

function baseMimeType(mimeType: string): string {
  return (mimeType.split(";", 1)[0] ?? "").trim().toLowerCase();
}

export function chatVisualResponse(bytes: Uint8Array): Response {
  if (bytes.byteLength > CHAT_VISUAL_PAGE_LIMIT) return new Response("Not found", { status: 404 });
  return new Response(chatVisualDocument(new TextDecoder().decode(bytes)), {
    headers: {
      "Content-Type": "text/html; charset=utf-8",
      "Content-Security-Policy": "sandbox allow-scripts allow-forms",
      "Cache-Control": "no-store",
      "X-Content-Type-Options": "nosniff",
    },
  });
}

/**
 * Only the app may read an attachment across origins. A visual reply page has the origin `null`;
 * if the scheme echoed it, the page could read every attachment.
 */
export function attachmentCorsHeaders(
  origin: string | null,
  developmentUrl = process.env.ELECTRON_RENDERER_URL,
): Record<string, string> {
  if (origin && isTrustedRendererUrl(origin, developmentUrl)) {
    return { "Access-Control-Allow-Origin": origin, Vary: "Origin" };
  }
  return { Vary: "Origin" };
}

/**
 * An HTML or SVG attachment that a frame opens directly runs with no scripts and an opaque origin,
 * so it cannot read the other attachments of the same scheme. Other files, such as a PDF in the
 * file preview, keep their plain response.
 */
export function attachmentDocumentHeaders(mimeType: string): Record<string, string> {
  return DOCUMENT_MIME_TYPES.has(baseMimeType(mimeType)) ? { "Content-Security-Policy": "sandbox" } : {};
}
