export type ChatPreviewKind = "html" | "mermaid";

const PREVIEW_LANGUAGES = new Map<string, ChatPreviewKind>([
  ["html", "html"],
  ["htm", "html"],
  ["xhtml", "html"],
  ["mermaid", "mermaid"],
  ["mmd", "mermaid"],
]);

export function chatPreviewKind(language: string | undefined): ChatPreviewKind | null {
  const name = language?.trim().split(/\s+/u)[0]?.toLowerCase() ?? "";
  return PREVIEW_LANGUAGES.get(name) ?? null;
}

export const CHAT_HTML_PREVIEW_POLICY = [
  "default-src 'none'",
  "style-src 'unsafe-inline'",
  "img-src data:",
  "font-src data:",
  "media-src data:",
  "form-action 'none'",
  "base-uri 'none'",
].join("; ");

export function chatHtmlPreviewDocument(html: string): string {
  return [
    "<!doctype html>",
    '<html><head><meta charset="utf-8">',
    `<meta http-equiv="Content-Security-Policy" content="${CHAT_HTML_PREVIEW_POLICY}">`,
    '<meta name="viewport" content="width=device-width, initial-scale=1">',
    '<base target="_blank">',
    "<style>html{color-scheme:light;background:Canvas;color:CanvasText}body{margin:0;padding:12px;font-family:system-ui,sans-serif}</style>",
    "</head><body>",
    html,
    "</body></html>",
  ].join("");
}

const MERMAID_REMOTE_CONTENT_HINT = /img|image|icon|sprite|href|src|url|import|http|\/\/|\\|&#/iu;

export function mermaidMayLoadRemoteContent(source: string): boolean {
  return MERMAID_REMOTE_CONTENT_HINT.test(source);
}

export const CHAT_MERMAID_FONT_FAMILY =
  '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif';

export function sizedMermaidSvg(svg: string): string {
  const viewBox = /<svg\b[^>]*\bviewBox="([^"]+)"/u.exec(svg)?.[1];
  const [, , width, height] =
    viewBox
      ?.trim()
      .split(/[\s,]+/u)
      .map(Number) ?? [];
  if (!width || !height || !Number.isFinite(width) || !Number.isFinite(height)) return svg;
  return svg.replace(/<svg\b[^>]*>/u, (tag) =>
    tag
      .replace(/\s(?:width|height)="[^"]*"/gu, "")
      .replace(/\sstyle="[^"]*"/u, "")
      .replace(/^<svg/u, `<svg width="${Math.ceil(width)}" height="${Math.ceil(height)}"`),
  );
}

export function mermaidImageUrl(svg: string): string {
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(sizedMermaidSvg(svg))}`;
}
