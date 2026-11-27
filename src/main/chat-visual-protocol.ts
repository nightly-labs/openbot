import {
  CHAT_VISUAL_FRAME_SANDBOX,
  CHAT_VISUAL_NO_DNS_PREFETCH,
  CHAT_VISUAL_PAGE_LIMIT,
  CHAT_VISUAL_STATIC_APPEARANCE_PARAMETER,
  CHAT_VISUAL_STATIC_PARAMETER,
  type ChatVisualDocumentOptions,
  chatVisualAppTheme,
  chatVisualDocument,
  withoutResourceHints,
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

export function staticChatVisualOptions(url: URL): ChatVisualDocumentOptions | null {
  if (url.searchParams.get(CHAT_VISUAL_STATIC_PARAMETER) !== "1") return null;
  const appearance = url.searchParams.get(CHAT_VISUAL_STATIC_APPEARANCE_PARAMETER);
  return appearance === "light" || appearance === "dark" ? { theme: chatVisualAppTheme(appearance), appearance } : {};
}

export function chatVisualResponse(
  bytes: Uint8Array,
  options: ChatVisualDocumentOptions = {},
  staticOptions: ChatVisualDocumentOptions | null = null,
): Response {
  if (bytes.byteLength > CHAT_VISUAL_PAGE_LIMIT) return new Response("Not found", { status: 404 });
  const staticPage = staticOptions !== null;
  const html = new TextDecoder().decode(bytes);
  const document = staticPage
    ? chatVisualDocument(withoutResourceHints(html), {
        ...options,
        ...staticOptions,
        head: `${CHAT_VISUAL_NO_DNS_PREFETCH}${options.head ?? ""}`,
        bootstrap: false,
      })
    : chatVisualDocument(html, options);
  return new Response(document, {
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
