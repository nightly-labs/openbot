/**
 * The fenced code blocks that desktop, web and mobile show as a preview instead of as code: ```html
 * as a rendered page and ```mermaid as a diagram. Both apps read the same fence names and build the
 * same isolated HTML document, so an agent reply looks the same on each screen.
 */
export type ChatPreviewKind = "html" | "mermaid";

const PREVIEW_LANGUAGES: Record<string, ChatPreviewKind> = {
  html: "html",
  htm: "html",
  xhtml: "html",
  mermaid: "mermaid",
  mmd: "mermaid",
};

/** The preview for the info string of a fenced code block, or null when the block stays code. */
export function chatPreviewKind(language: string | undefined): ChatPreviewKind | null {
  const name = language?.trim().split(/\s+/u)[0]?.toLowerCase() ?? "";
  return PREVIEW_LANGUAGES[name] ?? null;
}

/**
 * The policy of a previewed HTML page. The page can use inline styles and `data:` images and
 * fonts, and nothing else: no script, no request to a server, no form submission. An agent or a
 * teammate's host writes this HTML, so a preview cannot run code or tell a server that it opened.
 * The iframe that shows it has no `allow-scripts` either; this policy also stops the requests that
 * a page makes without a script, such as an image or a stylesheet from a server.
 */
export const CHAT_HTML_PREVIEW_POLICY = [
  "default-src 'none'",
  "style-src 'unsafe-inline'",
  "img-src data:",
  "font-src data:",
  "media-src data:",
  "form-action 'none'",
  "base-uri 'none'",
].join("; ");

/**
 * The HTML of a fenced block as a whole document for a sandboxed iframe. The policy comes first, so
 * it covers everything the agent wrote, also a `<head>` or a second policy of its own: a second
 * policy can only add limits. A link opens in a new window, which the sandbox blocks unless the app
 * opens the link itself.
 */
export function chatHtmlPreviewDocument(html: string): string {
  return [
    "<!doctype html>",
    '<html><head><meta charset="utf-8">',
    `<meta http-equiv="Content-Security-Policy" content="${CHAT_HTML_PREVIEW_POLICY}">`,
    '<meta name="viewport" content="width=device-width, initial-scale=1">',
    '<base target="_blank">',
    // A page that sets no colours expects a white page, as in a browser, also in a dark app.
    "<style>html{color-scheme:light;background:Canvas;color:CanvasText}body{margin:0;padding:12px;font-family:system-ui,sans-serif}</style>",
    "</head><body>",
    html,
    "</body></html>",
  ].join("");
}

/**
 * The fonts of a Mermaid diagram. Each app draws the SVG as an image, and an image cannot load the
 * app's web fonts, so Mermaid measures its labels with a system font that the image also has.
 */
export const CHAT_MERMAID_FONT_FAMILY =
  '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif';

/**
 * A Mermaid SVG as an image with its own size. Mermaid writes `width="100%"` and a `max-width`
 * style, so an `<img>` of the SVG would have no natural size. The viewBox gives the drawn size.
 */
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

/** A Mermaid SVG as an image URL. An image cannot run a script or load a resource. */
export function mermaidImageUrl(svg: string): string {
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(sizedMermaidSvg(svg))}`;
}
