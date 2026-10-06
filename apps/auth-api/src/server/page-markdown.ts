// The Markdown copy of an article page (`/guides/some-guide.md`, as llmstxt.org
// proposes) and `/llms-full.txt`, which holds every one of them. An assistant that
// reads a page gets its text without the navigation, the scripts and the styles.
//
// The text comes from the page itself: the Worker renders the HTML page and turns
// its `<article>` into Markdown. A second copy of the words, kept beside the page,
// would drift from it. The input is the site's own server render, so the parser
// below reads only what that render writes; it is not a general HTML parser.

import { CONTENT_COLLECTIONS } from "../lib/content";
import { articlePath, articleUrl, type ContentCollection, findArticle } from "../lib/content-collection";
import { siteUrlForPage } from "../lib/site-metadata";
import { FEED_CACHE_CONTROL } from "./content-feed";

type RenderPage = (request: Request) => Response | Promise<Response>;

interface ElementNode {
  tag: string;
  attributes: Record<string, string>;
  children: HtmlNode[];
}
type HtmlNode = ElementNode | string;

const VOID_ELEMENTS = new Set(["area", "br", "col", "embed", "hr", "img", "input", "link", "meta", "source", "wbr"]);

/** Elements whose content is code, styling or a control, never text to read. */
const SKIPPED_ELEMENTS = new Set([
  "button",
  "canvas",
  "dialog",
  "form",
  "iframe",
  "noscript",
  "script",
  "select",
  "style",
  "svg",
  "template",
  "textarea",
  "video",
]);

const BLOCK_ELEMENTS = new Set([
  "article",
  "aside",
  "blockquote",
  "details",
  "div",
  "figcaption",
  "figure",
  "footer",
  "h1",
  "h2",
  "h3",
  "h4",
  "h5",
  "h6",
  "header",
  "hr",
  "li",
  "main",
  "nav",
  "ol",
  "p",
  "pre",
  "section",
  "summary",
  "table",
  "ul",
]);

const NAMED_ENTITIES: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " " };

function decodeEntities(text: string): string {
  return text.replace(/&(#x[0-9a-f]+|#[0-9]+|[a-z]+);/giu, (entity, name: string) => {
    if (name.startsWith("#x") || name.startsWith("#X")) return String.fromCodePoint(Number.parseInt(name.slice(2), 16));
    if (name.startsWith("#")) return String.fromCodePoint(Number.parseInt(name.slice(1), 10));
    return NAMED_ENTITIES[name.toLowerCase()] ?? entity;
  });
}

function parseAttributes(source: string): Record<string, string> {
  const attributes: Record<string, string> = {};
  for (const match of source.matchAll(/([^\s=/>]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+)))?/gu)) {
    const name = match[1];
    if (name) attributes[name.toLowerCase()] = decodeEntities(match[2] ?? match[3] ?? match[4] ?? "");
  }
  return attributes;
}

/** The children of a root element, from the tags of a server render. Comments are hydration markers. */
function parseHtml(html: string): HtmlNode[] {
  const root: ElementNode = { tag: "#root", attributes: {}, children: [] };
  const open: ElementNode[] = [root];
  const tokens = /<!--[\s\S]*?-->|<(\/?)([a-zA-Z][a-zA-Z0-9-]*)((?:"[^"]*"|'[^']*'|[^'">])*)>|([^<]+)|</gu;
  // `exec`, not `matchAll`: `matchAll` reads a copy of the pattern, so it would not
  // see the jump over a script below.
  for (let token = tokens.exec(html); token; token = tokens.exec(html)) {
    const current = open.at(-1) ?? root;
    const [whole, closing, rawTag, rawAttributes = "", text] = token;
    if (text !== undefined) {
      current.children.push(decodeEntities(text));
      continue;
    }
    if (!rawTag) {
      if (whole === "<") current.children.push("<");
      continue;
    }
    const tag = rawTag.toLowerCase();
    if (closing) {
      const index = open.findLastIndex((element) => element.tag === tag);
      if (index > 0) open.length = index;
      continue;
    }
    const element: ElementNode = { tag, attributes: parseAttributes(rawAttributes), children: [] };
    current.children.push(element);
    if (VOID_ELEMENTS.has(tag) || rawAttributes.trimEnd().endsWith("/")) continue;
    if (tag === "script" || tag === "style") {
      // Their content is not markup, and may hold a "<" that is not a tag.
      const end = html.indexOf(`</${tag}`, token.index + whole.length);
      tokens.lastIndex = end === -1 ? html.length : end;
    }
    open.push(element);
  }
  return root.children;
}

function findElement(nodes: readonly HtmlNode[], tag: string): ElementNode | undefined {
  for (const node of nodes) {
    if (typeof node === "string") continue;
    if (node.tag === tag) return node;
    const found = findElement(node.children, tag);
    if (found) return found;
  }
  return undefined;
}

function isSkipped(node: ElementNode): boolean {
  return SKIPPED_ELEMENTS.has(node.tag) || node.attributes["aria-hidden"] === "true" || "hidden" in node.attributes;
}

function isBlock(node: HtmlNode): node is ElementNode {
  return typeof node !== "string" && BLOCK_ELEMENTS.has(node.tag);
}

/** A link target as an absolute URL, or nothing for a link within the same page. */
function absoluteUrl(href: string | undefined, base: string): string | undefined {
  if (!href || href.startsWith("#")) return undefined;
  try {
    return new URL(href, base).toString();
  } catch {
    return undefined;
  }
}

function inlineText(nodes: readonly HtmlNode[], base: string): string {
  let text = "";
  for (const node of nodes) {
    if (typeof node === "string") {
      text += node;
      continue;
    }
    if (isSkipped(node)) continue;
    const part = inlineElement(node, base);
    // A label and its hint, or a name and its description, are apart on the page
    // through their styles alone. Keep their words apart here.
    if (/[\p{L}\p{N}]$/u.test(text) && /^[\p{L}\p{N}]/u.test(part)) text += " ";
    text += part;
  }
  return text.replace(/\s+/gu, " ");
}

function inlineElement(node: ElementNode, base: string): string {
  const content = () => inlineText(node.children, base).trim();
  switch (node.tag) {
    case "br":
      return " ";
    case "img": {
      const alt = node.attributes.alt?.trim();
      const src = absoluteUrl(node.attributes.src, base);
      return alt && src ? `![${alt}](${src})` : "";
    }
    case "a": {
      const text = content();
      const href = absoluteUrl(node.attributes.href, base);
      return href && text ? `[${text}](${href})` : text;
    }
    case "strong":
    case "b":
      return wrapInline(content(), "**");
    case "em":
    case "i":
      return wrapInline(content(), "_");
    case "code":
      return wrapInline(content(), "`");
    default:
      return inlineText(node.children, base);
  }
}

function wrapInline(text: string, mark: string): string {
  return text ? `${mark}${text}${mark}` : "";
}

/** The Markdown blocks of a run of nodes, in order. Text between blocks becomes a paragraph. */
function blocks(nodes: readonly HtmlNode[], base: string): string[] {
  const result: string[] = [];
  let inline: HtmlNode[] = [];
  const flush = () => {
    const paragraph = inlineText(inline, base).trim();
    if (paragraph) result.push(paragraph);
    inline = [];
  };
  for (const node of nodes) {
    if (typeof node !== "string" && isSkipped(node)) continue;
    if (!isBlock(node)) {
      inline.push(node);
      continue;
    }
    flush();
    result.push(...blockElement(node, base));
  }
  flush();
  return result;
}

function blockElement(node: ElementNode, base: string): string[] {
  const heading = /^h([1-6])$/u.exec(node.tag);
  if (heading) {
    const text = inlineText(node.children, base).trim();
    return text ? [`${"#".repeat(Number(heading[1]))} ${text}`] : [];
  }
  switch (node.tag) {
    case "hr":
      return ["---"];
    case "summary": {
      const text = inlineText(node.children, base).trim();
      return text ? [`### ${text}`] : [];
    }
    case "ul":
    case "ol":
      return listBlock(node, base);
    case "table":
      return tableBlock(node, base);
    case "pre": {
      const text = textContent(node).replace(/\n+$/u, "");
      return text ? [`\`\`\`\n${text}\n\`\`\``] : [];
    }
    case "blockquote":
      return blocks(node.children, base).map((block) => block.replace(/^/gmu, "> "));
    default:
      return blocks(node.children, base);
  }
}

function textContent(node: HtmlNode): string {
  return typeof node === "string" ? node : node.children.map(textContent).join("");
}

function listBlock(list: ElementNode, base: string): string[] {
  const items = list.children.filter((child): child is ElementNode => typeof child !== "string" && child.tag === "li");
  const lines = items.flatMap((item, index) => {
    const marker = list.tag === "ol" ? `${index + 1}. ` : "- ";
    const content = blocks(item.children, base).join("\n\n");
    if (!content) return [];
    // Continuation lines line up under the text; a blank line stays blank.
    return [`${marker}${content.replace(/\n(?=.)/gu, `\n${" ".repeat(marker.length)}`)}`];
  });
  return lines.length > 0 ? [lines.join("\n")] : [];
}

function tableBlock(table: ElementNode, base: string): string[] {
  const caption = findElement(table.children, "caption");
  const rows: string[][] = [];
  const collectRows = (nodes: readonly HtmlNode[]) => {
    for (const node of nodes) {
      if (typeof node === "string") continue;
      if (node.tag === "tr") {
        rows.push(
          node.children
            .filter((cell): cell is ElementNode => typeof cell !== "string" && (cell.tag === "th" || cell.tag === "td"))
            .map((cell) => (isSkipped(cell) ? "" : inlineText(cell.children, base).trim().replaceAll("|", "\\|"))),
        );
      } else if (node.tag !== "caption") {
        collectRows(node.children);
      }
    }
  };
  collectRows(table.children);
  const [header, ...body] = rows;
  if (!header) return [];
  const line = (cells: readonly string[]) => `| ${cells.join(" | ")} |`;
  const result = [[line(header), line(header.map(() => "---")), ...body.map((cells) => line(cells))].join("\n")];
  const captionText = caption ? inlineText(caption.children, base).trim() : "";
  return captionText ? [captionText, ...result] : result;
}

/** The Markdown of the first `<article>` of a page, with links made absolute against `base`. */
export function articleMarkdown(html: string, base: string): string | undefined {
  const article = findElement(parseHtml(html), "article");
  if (!article) return undefined;
  return `${blocks(article.children, base).join("\n\n")}\n`;
}

/** The article a path such as `/guides/openbot-101.md` names, or nothing when it names none. */
function markdownTarget(pathname: string): { collection: ContentCollection; slug: string } | undefined {
  const match = /^\/([a-z]+)\/([a-z0-9-]+)\.md$/u.exec(pathname);
  if (!match) return undefined;
  const [, collectionId, slug = ""] = match;
  const collection = CONTENT_COLLECTIONS.find((candidate) => candidate.id === collectionId);
  return collection && findArticle(collection, slug) ? { collection, slug } : undefined;
}

type RenderedMarkdown = { markdown: string } | { failure: Response };

/**
 * Renders the HTML page at `path` through the site's own handler and keeps its article.
 * Links in it name `siteUrl`, the site the page goes by, whichever host asked.
 */
async function renderArticle(
  request: Request,
  path: string,
  siteUrl: string,
  renderPage: RenderPage,
): Promise<RenderedMarkdown> {
  const page = await renderPage(new Request(new URL(path, request.url), { headers: { Accept: "text/html" } }));
  if (!page.ok) return { failure: page };
  const markdown = articleMarkdown(await page.text(), new URL(path, siteUrl).toString());
  return markdown === undefined ? { failure: new Response(null, { status: 500 }) } : { markdown };
}

function markdownHeaders(contentType: string): Record<string, string> {
  return {
    "Content-Type": contentType,
    "Cache-Control": FEED_CACHE_CONTROL,
    "X-Content-Type-Options": "nosniff",
  };
}

/**
 * `/llms-full.txt` for each site URL. It renders every article, and the articles
 * change only with a deploy, so an isolate renders it once. Only the finished text
 * is kept: a Worker request can not wait on a promise that another request made.
 */
const FULL_TEXT_BY_SITE = new Map<string, string>();

/**
 * The Markdown copy of an article, or `/llms-full.txt`. `undefined` for every other
 * request, which then goes to the site as usual.
 */
export async function pageMarkdownResponse(request: Request, renderPage: RenderPage): Promise<Response | undefined> {
  if (request.method !== "GET" && request.method !== "HEAD") return undefined;
  const requestUrl = new URL(request.url);
  const siteUrl = siteUrlForPage(requestUrl);

  if (requestUrl.pathname === "/llms-full.txt") {
    let fullText = FULL_TEXT_BY_SITE.get(siteUrl);
    if (fullText === undefined) {
      const pages: string[] = [];
      for (const collection of CONTENT_COLLECTIONS) {
        for (const article of collection.articles) {
          const rendered = await renderArticle(request, articlePath(collection, article.slug), siteUrl, renderPage);
          if ("failure" in rendered) return rendered.failure;
          pages.push(`Source: ${articleUrl(collection, article.slug, siteUrl)}\n\n${rendered.markdown}`);
        }
      }
      fullText = pages.join("\n---\n\n");
      FULL_TEXT_BY_SITE.set(siteUrl, fullText);
    }
    return new Response(fullText, {
      headers: {
        ...markdownHeaders("text/plain; charset=utf-8"),
        // Every page in it has its own URL, and a search result should name that one.
        "X-Robots-Tag": "noindex",
      },
    });
  }

  const target = markdownTarget(requestUrl.pathname);
  if (!target) return undefined;
  const rendered = await renderArticle(request, articlePath(target.collection, target.slug), siteUrl, renderPage);
  if ("failure" in rendered) return rendered.failure;
  return new Response(rendered.markdown, {
    headers: {
      ...markdownHeaders("text/markdown; charset=utf-8"),
      // The same words as the HTML page, which is the one a search result should name.
      Link: `<${articleUrl(target.collection, target.slug, siteUrl)}>; rel="canonical"`,
    },
  });
}
