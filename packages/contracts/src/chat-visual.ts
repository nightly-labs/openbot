import { INPUT_LIMITS } from "./input-limits";
import { isBoundedString } from "./ipc-bounded-values";
import { isBoolean, isDynamicRecord, isNumber, isOneOf } from "./runtime-values";

/**
 * A visual reply: an HTML page that an agent publishes to show a chart, a table, a diagram or a
 * mockup above its reply. Unlike a ```html preview, the page runs its scripts and can load files
 * from a CDN. It runs in a sandboxed frame with an opaque origin, so it cannot reach the app. The
 * app and the page talk with the JSON-RPC messages of MCP Apps: the page reports its height, asks
 * the app to open a link, to fill the window, to put a message in the user's message box or to keep
 * its state for the agent, and the app sends the theme colours and the display mode. A request that
 * acts for the user needs a click or a key in the page just before it.
 */

/** The frame is never lower or higher than this, whatever the page reports. */
export const CHAT_VISUAL_MIN_HEIGHT = 80;
export const CHAT_VISUAL_MAX_HEIGHT = 2000;
/** The height that the frame keeps for a page before the page reports its own. */
export const CHAT_VISUAL_DEFAULT_HEIGHT = 240;

/** The prefix of the URL fragment that gives the page its theme before its first paint. */
export const CHAT_VISUAL_THEME_FRAGMENT = "openbot-theme=";

export const CHAT_VISUAL_SIZE_CHANGED = "ui/notifications/size-changed";
export const CHAT_VISUAL_HOST_CONTEXT_CHANGED = "ui/notifications/host-context-changed";
export const CHAT_VISUAL_OPEN_LINK = "ui/open-link";
export const CHAT_VISUAL_REQUEST_DISPLAY_MODE = "ui/request-display-mode";
export const CHAT_VISUAL_MESSAGE = "ui/message";
export const CHAT_VISUAL_UPDATE_MODEL_CONTEXT = "ui/update-model-context";
/** OpenBot's own notifications: MCP Apps has no method for these. */
export const CHAT_VISUAL_OPEN_IMAGE = "openbot/notifications/open-image";
export const CHAT_VISUAL_KEY_DOWN = "openbot/notifications/keydown";

export type ChatVisualDisplayMode = "inline" | "fullscreen";
const DISPLAY_MODES: readonly ChatVisualDisplayMode[] = ["inline", "fullscreen"];

/** The most characters of page context, the limit of a quote in the composer. */
export const CHAT_VISUAL_CONTEXT_LIMIT = 2_000;
/** The most characters of an image address, so a `data:` image as large as a page still opens. */
const IMAGE_SOURCE_LIMIT = 8 * 1_024 * 1_024;
/** An image that the app shows from a page. SVG is safe here: an image cannot run its scripts. */
const DATA_IMAGE = /^data:image\/(?:png|jpeg|gif|webp|avif|svg\+xml)[;,]/iu;
const KEY_LIMIT = 32;
/** The most text blocks in one message, so a page cannot make the app join a large array. */
const CONTENT_BLOCK_LIMIT = 32;

/**
 * The `itemType` of a visual reply message: the prefix, then the height that the agent asked for,
 * or nothing. The message text is the page title, and its one attachment is the page. A client
 * that does not know the prefix shows the title and the HTML file.
 */
export const CHAT_VISUAL_ITEM_TYPE_PREFIX = "visual-reply:";
/** The most characters of HTML that an agent can publish as one page. */
export const CHAT_VISUAL_HTML_LIMIT = 512_000;
/** A larger page file is not shown: the frame would hold all of it in memory. */
export const CHAT_VISUAL_PAGE_LIMIT = 8 * 1_024 * 1_024;
/**
 * The sandbox of a visual reply page: scripts and forms, but never `allow-same-origin`, popups,
 * downloads or top navigation. The page has an opaque origin, so it cannot read the app or its
 * storage. The desktop scheme sends it as a header, and the frame sets it as an attribute.
 */
export const CHAT_VISUAL_FRAME_SANDBOX = "allow-scripts allow-forms";
export const CHAT_VISUAL_TITLE_LIMIT = 200;

export function chatVisualItemType(height?: number): string {
  return `${CHAT_VISUAL_ITEM_TYPE_PREFIX}${height !== undefined && Number.isFinite(height) ? clampHeight(height) : ""}`;
}

/** The page and the requested height of a visual reply message, or null for any other message. */
/** Only an HTML file can be a visual page. */
export function isChatVisualMimeType(mimeType: string): boolean {
  return (mimeType.split(";", 1)[0] ?? "").trim().toLowerCase() === "text/html";
}

export function chatVisualReply<Attachment extends { mimeType: string }>(message: {
  itemType?: string | null | undefined;
  attachments?: readonly Attachment[] | null | undefined;
}): { attachment: Attachment; height?: number } | null {
  if (!message.itemType?.startsWith(CHAT_VISUAL_ITEM_TYPE_PREFIX)) return null;
  const attachment = message.attachments?.length === 1 ? message.attachments[0] : undefined;
  if (!attachment || !isChatVisualMimeType(attachment.mimeType)) return null;
  const height = message.itemType.slice(CHAT_VISUAL_ITEM_TYPE_PREFIX.length);
  return /^\d{1,4}$/u.test(height) ? { attachment, height: clampHeight(Number(height)) } : { attachment };
}

/** CSS custom properties that the page can use, such as `--foreground` or `--chart-1`. */
export type ChatVisualTheme = Record<`--${string}`, string>;

export type ChatVisualAppearance = "dark" | "light";

/**
 * The app colours from `@openbot/brand` tokens, for a host that cannot read them from its own
 * styles. The background is the chat canvas.
 */
const APP_THEMES: Record<ChatVisualAppearance, ChatVisualTheme> = {
  dark: {
    "--background": "#1a1a1a",
    "--foreground": "#ffffff",
    "--muted-foreground": "#979797",
    "--muted": "#212121",
    "--card": "#212121",
    "--card-foreground": "#ffffff",
    "--border": "rgba(255, 255, 255, 0.045)",
    "--accent": "#42a0ff",
    "--destructive": "#ff6069",
    "--success": "#31cf76",
  },
  light: {
    "--background": "#f5f5f7",
    "--foreground": "#141414",
    "--muted-foreground": "rgba(20, 20, 20, 0.64)",
    "--muted": "#ffffff",
    "--card": "#ffffff",
    "--card-foreground": "#141414",
    "--border": "rgba(20, 20, 20, 0.16)",
    "--accent": "#5b52df",
    "--destructive": "#b02a2f",
    "--success": "#1e6f3b",
  },
};

const SHARED_APP_THEME: ChatVisualTheme = {
  "--chart-1": "#3987e5",
  "--chart-2": "#d95926",
  "--chart-3": "#199e70",
  "--chart-4": "#9085e9",
  "--chart-5": "#d6adf2",
  "--chart-6": "#6bc7d9",
  "--radius": "12px",
  "--font-sans": '"Inter Variable", -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',
  "--font-mono": 'ui-monospace, SFMono-Regular, "SF Mono", Menlo, Monaco, Consolas, monospace',
};

export function chatVisualAppTheme(appearance: ChatVisualAppearance): ChatVisualTheme {
  return { ...APP_THEMES[appearance], ...SHARED_APP_THEME };
}

/** A key that the user pressed in the page and that the page did not use. */
export interface ChatVisualKey {
  key: string;
  code: string;
  metaKey: boolean;
  ctrlKey: boolean;
  shiftKey: boolean;
  altKey: boolean;
}

/** A message from the page, after the app has checked it. */
export type ChatVisualMessage =
  | { type: "size"; height: number }
  | { type: "open-link"; id: number | string; url: string }
  | { type: "display-mode"; id: number | string; mode: ChatVisualDisplayMode }
  /** Text for the user's message box. The user reads it and sends it. */
  | { type: "message"; id: number | string; text: string }
  /** The page state for the agent, which goes with the user's next message. Empty text removes it. */
  | { type: "context"; id: number | string; text: string }
  /** A request with values out of range. The host refuses it, so the page's promise fails. */
  | { type: "refused"; id: number | string }
  | { type: "open-image"; src: string; name: string }
  | { type: "key"; key: ChatVisualKey };

/**
 * The frame height. The height that the agent asked for is the maximum: a taller page scrolls in
 * the frame. Before the page reports its height, the frame keeps the agent's height.
 */
export function chatVisualFrameHeight(reported?: number, requested?: number): number {
  const limit = requested !== undefined && Number.isFinite(requested) ? clampHeight(requested) : undefined;
  const height = reported !== undefined && Number.isFinite(reported) ? clampHeight(reported) : undefined;
  if (height === undefined) return limit ?? CHAT_VISUAL_DEFAULT_HEIGHT;
  return limit === undefined ? height : Math.min(limit, height);
}

function clampHeight(height: number): number {
  return Math.min(CHAT_VISUAL_MAX_HEIGHT, Math.max(CHAT_VISUAL_MIN_HEIGHT, Math.ceil(height)));
}

/** The page URL with the theme in its fragment. The page removes the fragment when it reads it. */
export function chatVisualFrameUrl(src: string, theme: ChatVisualTheme): string {
  const base = src.split("#", 1)[0] ?? src;
  return `${base}#${CHAT_VISUAL_THEME_FRAGMENT}${encodeURIComponent(JSON.stringify(theme))}`;
}

/** The message that sends the theme to a page that has loaded. */
export function chatVisualThemeMessage(theme: ChatVisualTheme) {
  return {
    jsonrpc: "2.0",
    method: CHAT_VISUAL_HOST_CONTEXT_CHANGED,
    params: { theme: "dark", styles: { variables: theme } },
  } as const;
}

/** The message that tells a page whether it shows in the chat or fills the window. */
export function chatVisualDisplayModeMessage(mode: ChatVisualDisplayMode) {
  return {
    jsonrpc: "2.0",
    method: CHAT_VISUAL_HOST_CONTEXT_CHANGED,
    params: { displayMode: mode, availableDisplayModes: DISPLAY_MODES },
  } as const;
}

/** What the host answers to a request that it did: the display mode for a display mode request. */
export interface ChatVisualReplyResult {
  mode?: ChatVisualDisplayMode;
}

/** The answer to a request of the page. A refused request gets an error, so its promise fails. */
export function chatVisualReplyMessage(id: number | string, result: ChatVisualReplyResult | null) {
  return result
    ? ({ jsonrpc: "2.0", id, result } as const)
    : ({ jsonrpc: "2.0", id, error: { code: -32000, message: "Refused" } } as const);
}

/**
 * Reads a message that a page posted. The page can post anything, so a message that is not one of
 * the known methods, or has a value out of range, gives null.
 */
export function parseChatVisualMessage(data: unknown): ChatVisualMessage | null {
  if (!isDynamicRecord(data) || data.jsonrpc !== "2.0" || !isDynamicRecord(data.params)) return null;
  const params = data.params;
  switch (data.method) {
    case CHAT_VISUAL_SIZE_CHANGED: {
      const height = params.height;
      return isNumber(height) && Number.isFinite(height) && height >= 0 ? { type: "size", height } : null;
    }
    case CHAT_VISUAL_OPEN_LINK: {
      const id = requestId(data.id);
      const url = isBoundedString(params.url, INPUT_LIMITS.browserUrl) ? webUrl(params.url) : null;
      return url && id !== null ? { type: "open-link", id, url } : refused(id);
    }
    case CHAT_VISUAL_REQUEST_DISPLAY_MODE: {
      const id = requestId(data.id);
      return id !== null && isOneOf(DISPLAY_MODES, params.mode)
        ? { type: "display-mode", id, mode: params.mode }
        : refused(id);
    }
    case CHAT_VISUAL_MESSAGE: {
      const id = requestId(data.id);
      const text = params.role === "user" ? contentText(params.content, INPUT_LIMITS.messageText) : null;
      return id !== null && text ? { type: "message", id, text } : refused(id);
    }
    case CHAT_VISUAL_UPDATE_MODEL_CONTEXT: {
      const id = requestId(data.id);
      const text = contentText(params.content, CHAT_VISUAL_CONTEXT_LIMIT);
      return id !== null && text !== null ? { type: "context", id, text } : refused(id);
    }
    case CHAT_VISUAL_OPEN_IMAGE: {
      const src = isBoundedString(params.src, IMAGE_SOURCE_LIMIT) ? imageUrl(params.src) : null;
      const name = params.name === undefined ? "" : params.name;
      return src && isBoundedString(name, CHAT_VISUAL_TITLE_LIMIT) ? { type: "open-image", src, name } : null;
    }
    case CHAT_VISUAL_KEY_DOWN: {
      const { key, code, metaKey, ctrlKey, shiftKey, altKey } = params;
      if (!isBoundedString(key, KEY_LIMIT) || !key || !isBoundedString(code, KEY_LIMIT)) return null;
      if (!isBoolean(metaKey) || !isBoolean(ctrlKey) || !isBoolean(shiftKey) || !isBoolean(altKey)) return null;
      // The page sends only a chord or Escape; any other key is typing, which stays in the page.
      if (!metaKey && !ctrlKey && key !== "Escape") return null;
      return { type: "key", key: { key, code, metaKey, ctrlKey, shiftKey, altKey } };
    }
    default:
      return null;
  }
}

function refused(id: number | string | null): ChatVisualMessage | null {
  return id === null ? null : { type: "refused", id };
}

function requestId(id: unknown): number | string | null {
  return (isNumber(id) && Number.isFinite(id)) || isBoundedString(id, INPUT_LIMITS.identifier) ? id : null;
}

/** The text of MCP content blocks, or null when a block is not text or the text is too long. */
function contentText(content: unknown, limit: number): string | null {
  if (!Array.isArray(content) || content.length > CONTENT_BLOCK_LIMIT) return null;
  const parts: string[] = [];
  for (const block of content) {
    if (!isDynamicRecord(block) || block.type !== "text" || !isBoundedString(block.text, limit)) return null;
    parts.push(block.text);
  }
  const text = parts.join("\n").trim();
  return text.length <= limit ? text : null;
}

function imageUrl(value: string): string | null {
  if (DATA_IMAGE.test(value)) return value;
  try {
    const url = new URL(value);
    return url.protocol === "https:" ? url.toString() : null;
  } catch {
    return null;
  }
}

function webUrl(value: string): string | null {
  try {
    const url = new URL(value);
    return url.protocol === "http:" || url.protocol === "https:" ? url.toString() : null;
  } catch {
    return null;
  }
}

/**
 * The base styles. The page has a transparent canvas in the dark scheme, so the chat shows
 * through it, and the theme variables have values even before the app sends the theme.
 */
const BASE_STYLE = [
  ":root{color-scheme:dark;--background:transparent;--foreground:CanvasText;--muted-foreground:GrayText;",
  "--border:rgba(127,127,127,.3);--card:rgba(127,127,127,.12);--radius:12px;",
  "--font-sans:system-ui,sans-serif;--font-mono:ui-monospace,monospace;scrollbar-width:none}",
  "::-webkit-scrollbar{display:none}",
  "body{margin:0;color:var(--foreground);font:14px/1.5 var(--font-sans)}",
  // A click on an image outside a link or a button shows it large.
  "img:not(a img,button img,label img){cursor:zoom-in}",
].join("");

/**
 * The script that runs first in the page. It applies the theme, reports the page height, scrolls
 * to links in the page (the sandbox blocks them as loads) and sends web links to the app. A `#`
 * link is read as written: a `srcdoc` page has the app address as its base, so a resolved one would
 * look like an app link.
 *
 * It also gives the page `window.openbotPage`, which posts the MCP Apps requests: a message for the
 * user's message box, the page state for the agent, and full screen. It sends a click on an image,
 * so the app can show it large, and a key chord that the page did not use, so app shortcuts still
 * work while the page has focus. The app checks each message again. The key listener adds a second
 * listener that runs last, and the image click waits a task, so each sees whether the page used
 * the key or the click first.
 *
 * Keep it plain ES2020 and without dependencies: it runs inside the page.
 */
const BOOTSTRAP = `(()=>{
const parentWindow=window.parent,root=document.documentElement,marker="#${CHAT_VISUAL_THEME_FRAGMENT}";
const apply=(theme)=>{if(!theme||typeof theme!=="object")return;for(const [name,value] of Object.entries(theme)){if(name.startsWith("--")&&typeof value==="string")root.style.setProperty(name,value);}};
if(location.hash.startsWith(marker)){
try{apply(JSON.parse(decodeURIComponent(location.hash.slice(marker.length))));}catch{}
try{history.replaceState(null,"",location.href.split("#")[0]);}catch{}
}
const send=(message)=>parentWindow.postMessage(Object.assign({jsonrpc:"2.0"},message),"*");
let nextId=1,displayMode="inline";
const pending=new Map();
const request=(method,params)=>new Promise((resolve,reject)=>{const id=nextId++;pending.set(id,{resolve,reject});send({id,method,params});});
addEventListener("message",(event)=>{
const data=event.data;
if(event.source!==parentWindow||!data||data.jsonrpc!=="2.0")return;
if(data.method==="${CHAT_VISUAL_HOST_CONTEXT_CHANGED}"){
const params=data.params||{};
apply(params.styles&&params.styles.variables);
if(params.displayMode==="inline"||params.displayMode==="fullscreen")displayMode=params.displayMode;
return;
}
const waiting=data.method===undefined&&pending.get(data.id);
if(!waiting)return;
pending.delete(data.id);
if(data.error)waiting.reject(new Error(String(data.error.message||"Refused")));else waiting.resolve(data.result);
});
const text=(value)=>value===undefined||value===null||value===""?[]:[{type:"text",text:String(value)}];
window.openbotPage=Object.freeze({
sendMessage:(value)=>request("${CHAT_VISUAL_MESSAGE}",{role:"user",content:text(value)}),
setContext:(value)=>request("${CHAT_VISUAL_UPDATE_MODEL_CONTEXT}",{content:text(value)}),
requestFullscreen:()=>request("${CHAT_VISUAL_REQUEST_DISPLAY_MODE}",{mode:"fullscreen"}),
exitFullscreen:()=>request("${CHAT_VISUAL_REQUEST_DISPLAY_MODE}",{mode:"inline"}),
get displayMode(){return displayMode;}
});
let lastHeight=-1;
const report=()=>{const height=Math.ceil(root.getBoundingClientRect().height);if(height===lastHeight)return;lastHeight=height;send({method:"${CHAT_VISUAL_SIZE_CHANGED}",params:{height}});};
new ResizeObserver(report).observe(root);
addEventListener("DOMContentLoaded",report);
addEventListener("load",report);
const fields=new Set(["INPUT","TEXTAREA","SELECT"]);
addEventListener("keydown",(event)=>{
if(!event.isTrusted||event.isComposing)return;
const escape=event.key==="Escape"&&displayMode==="fullscreen";
if(!escape&&!event.metaKey&&!event.ctrlKey)return;
const target=event.composedPath()[0];
if(!escape&&target instanceof Element&&(fields.has(target.tagName)||target.isContentEditable))return;
const late=(next)=>{
removeEventListener("keydown",late);
if(next!==event||event.defaultPrevented)return;
send({method:"${CHAT_VISUAL_KEY_DOWN}",params:{key:event.key,code:event.code,metaKey:event.metaKey,ctrlKey:event.ctrlKey,shiftKey:event.shiftKey,altKey:event.altKey}});
};
addEventListener("keydown",late);
setTimeout(()=>removeEventListener("keydown",late));
},true);
document.addEventListener("click",(event)=>{
if(!event.isTrusted||event.button!==0||event.metaKey||event.ctrlKey||event.shiftKey||event.altKey||!(event.target instanceof Element))return;
const image=event.target.closest("img");
if(!image||image.closest("a[href],button,label"))return;
setTimeout(()=>{
const src=image.currentSrc||image.src;
if(!event.defaultPrevented&&src)send({method:"${CHAT_VISUAL_OPEN_IMAGE}",params:{src,name:image.alt||image.title||""}});
});
});
document.addEventListener("click",(event)=>{
if(event.button!==0||!(event.target instanceof Element))return;
const link=event.target.closest("a[href],area[href]");
if(!link)return;
const href=link.getAttribute("href")||"";
if(href.startsWith("#")){
event.preventDefault();
const target=document.getElementById(decodeURIComponent(href.slice(1)));
if(target)target.scrollIntoView();
return;
}
if(!event.isTrusted)return;
let url;
try{url=new URL(link.getAttribute("href"),document.baseURI);}catch{return;}
if(url.hash&&url.href.split("#")[0]===location.href.split("#")[0]){
event.preventDefault();
const target=document.getElementById(decodeURIComponent(url.hash.slice(1)));
if(target)target.scrollIntoView();
return;
}
if(url.protocol!=="http:"&&url.protocol!=="https:")return;
event.preventDefault();
send({id:nextId++,method:"${CHAT_VISUAL_OPEN_LINK}",params:{url:url.href}});
},true);
})();`;

/** Options for a host that cannot give the theme in the URL fragment, such as a `srcdoc` frame. */
export interface ChatVisualDocumentOptions {
  theme?: ChatVisualTheme;
  /** The colour scheme of the frame element. A different one makes the browser fill the canvas. */
  appearance?: ChatVisualAppearance;
  /**
   * False for a host with no frame parent, such as a native web view. The page then gets no
   * bootstrap script: its links load as links, and `window.openbotPage` does not exist.
   */
  bootstrap?: boolean;
  /** More elements for the start of `<head>`, after the base style and before the page's own. */
  head?: string;
}

/** The theme as CSS. A value that could end the rule or the style element is left out. */
function themeStyle({ theme = {}, appearance }: ChatVisualDocumentOptions): string {
  const declarations = Object.entries(theme)
    .filter(([name, value]) => /^--[\w-]+$/u.test(name) && !/[<>{};]/u.test(value))
    .map(([name, value]) => `${name}:${value};`);
  if (appearance) declarations.unshift(`color-scheme:${appearance};`);
  return declarations.length ? `:root{${declarations.join("")}}` : "";
}

function preamble(options: ChatVisualDocumentOptions): string {
  return [
    '<meta charset="utf-8">',
    '<meta name="viewport" content="width=device-width, initial-scale=1">',
    `<style id="openbot-visual-base">${BASE_STYLE}${themeStyle(options)}</style>`,
    options.head ?? "",
    options.bootstrap === false ? "" : `<script id="openbot-visual-bootstrap">${BOOTSTRAP}</script>`,
  ].join("");
}

/**
 * The page that an agent wrote, with the base styles and the bootstrap script at the start of its
 * `<head>`, so they come before every style and script of the agent. A `<head>`, `<html>` or
 * doctype tag only counts when no comment, script, style or template comes before it; otherwise
 * the preamble goes before everything. A page with no doctype gets one: in quirks mode the root
 * fills the frame, so the page cannot report its own height.
 */
export function chatVisualDocument(html: string, options: ChatVisualDocumentOptions = {}): string {
  const head = preamble(options);
  const opening = /<(?:!--|script\b|style\b|template\b|textarea\b|title\b)/iu.exec(html)?.index ?? html.length;
  const doctype = /<!doctype\b[^>]*>/iu.exec(html);
  const standards = doctype && doctype.index < opening ? "" : "<!doctype html>";
  for (const tag of [/<head\b[^>]*>/iu, /<html\b[^>]*>/iu, /<!doctype\b[^>]*>/iu]) {
    const match = tag.exec(html);
    if (match && match.index < opening) {
      const end = match.index + match[0].length;
      const inserted = tag.source.startsWith("<head") ? head : `<head>${head}</head>`;
      return `${standards}${html.slice(0, end)}${inserted}${html.slice(end)}`;
    }
  }
  return `<!doctype html><html><head>${head}</head><body>${html}</body></html>`;
}
