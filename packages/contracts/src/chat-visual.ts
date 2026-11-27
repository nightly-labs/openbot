import { INPUT_LIMITS } from "./input-limits";
import { type AvatarColor, isAvatarColor } from "./ipc-agent-identity";
import { isBoundedString, isIdentifier } from "./ipc-bounded-values";
import { SIGNED_OUT_CHANNEL_MEMBER_ID } from "./ipc-chat-channels";
import { isBoolean, isDynamicRecord, isNumber, isOneOf } from "./runtime-values";

export const CHAT_VISUAL_MIN_HEIGHT = 80;
export const CHAT_VISUAL_MAX_HEIGHT = 2000;
export const CHAT_VISUAL_DEFAULT_HEIGHT = 240;

export const CHAT_VISUAL_THEME_FRAGMENT = "openbot-theme=";

export const CHAT_VISUAL_SIZE_CHANGED = "ui/notifications/size-changed";
export const CHAT_VISUAL_HOST_CONTEXT_CHANGED = "ui/notifications/host-context-changed";
export const CHAT_VISUAL_OPEN_LINK = "ui/open-link";
export const CHAT_VISUAL_REQUEST_DISPLAY_MODE = "ui/request-display-mode";
export const CHAT_VISUAL_MESSAGE = "ui/message";
export const CHAT_VISUAL_UPDATE_MODEL_CONTEXT = "ui/update-model-context";
export const CHAT_VISUAL_OPEN_IMAGE = "openbot/notifications/open-image";
export const CHAT_VISUAL_KEY_DOWN = "openbot/notifications/keydown";
export const CHAT_VISUAL_SELECTION_CHANGED = "openbot/notifications/selection-changed";
export const CHAT_VISUAL_FOCUSED = "openbot/notifications/focused";

export type ChatVisualDisplayMode = "inline" | "fullscreen";
const DISPLAY_MODES: readonly ChatVisualDisplayMode[] = ["inline", "fullscreen"];

export const CHAT_VISUAL_CONTEXT_LIMIT = 2_000;
const IMAGE_SOURCE_LIMIT = 8 * 1_024 * 1_024;
const DATA_IMAGE = /^data:image\/(?:png|jpeg|gif|webp|avif|svg\+xml)[;,]/iu;
const KEY_LIMIT = 32;
const CONTENT_BLOCK_LIMIT = 32;

export const CHAT_VISUAL_ITEM_TYPE_PREFIX = "visual-reply:";
export const CHAT_VISUAL_HTML_LIMIT = 512_000;
export const CHAT_VISUAL_PAGE_LIMIT = 8 * 1_024 * 1_024;
export const CHAT_VISUAL_FRAME_SANDBOX = "allow-scripts allow-forms";
export const CHAT_VISUAL_TITLE_LIMIT = 200;

export function chatVisualItemType(height?: number): string {
  return `${CHAT_VISUAL_ITEM_TYPE_PREFIX}${height !== undefined && Number.isFinite(height) ? clampHeight(height) : ""}`;
}

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

export const CHAT_BACKDROP_ITEM_TYPE = "window-backdrop";

export function chatBackdropPage<Attachment extends { mimeType: string }>(message: {
  itemType?: string | null | undefined;
  attachments?: readonly Attachment[] | null | undefined;
}): Attachment | null {
  if (message.itemType !== CHAT_BACKDROP_ITEM_TYPE) return null;
  const attachment = message.attachments?.length === 1 ? message.attachments[0] : undefined;
  return attachment && isChatVisualMimeType(attachment.mimeType) ? attachment : null;
}

export interface ChatBackdropBubbles {
  yours?: AvatarColor;
  agents?: AvatarColor;
}

const BUBBLES_META_NAME = "openbot-bubbles";
const BUBBLES_META_PATTERN = /<meta\b[^>]*\bname\s*=\s*["']openbot-bubbles["'][^>]*>/iu;
const META_CONTENT_PATTERN = /\bcontent\s*=\s*(?:"([^"]*)"|'([^']*)')/iu;
const DOCTYPE_PATTERN = /^\s*<!doctype\b[^>]*>/iu;

export function chatBackdropBubbles(html: string): ChatBackdropBubbles | null {
  const tag = BUBBLES_META_PATTERN.exec(html)?.[0];
  const content = tag ? META_CONTENT_PATTERN.exec(tag) : null;
  const value = content?.[1] ?? content?.[2];
  if (value === undefined) return null;
  const bubbles: ChatBackdropBubbles = {};
  for (const part of value.split(";")) {
    const [key, color] = part.split("=", 2).map((text) => text.trim().toLowerCase());
    if (!isAvatarColor(color)) continue;
    if (key === "yours") bubbles.yours = color;
    else if (key === "agents") bubbles.agents = color;
  }
  return bubbles.yours === undefined && bubbles.agents === undefined ? null : bubbles;
}

export function withChatBackdropBubbles(html: string, bubbles: ChatBackdropBubbles): string {
  const parts = [
    bubbles.yours === undefined ? undefined : `yours=${bubbles.yours}`,
    bubbles.agents === undefined ? undefined : `agents=${bubbles.agents}`,
  ].filter((part) => part !== undefined);
  const page = html.replace(BUBBLES_META_PATTERN, "");
  if (parts.length === 0) return page;
  return withLeadingMeta(page, `<meta name="${BUBBLES_META_NAME}" content="${parts.join("; ")}">`);
}

function withLeadingMeta(page: string, tag: string): string {
  const doctype = DOCTYPE_PATTERN.exec(page)?.[0];
  return doctype === undefined ? `${tag}${page}` : `${doctype}${tag}${page.slice(doctype.length)}`;
}

const REQUESTERS_META_NAME = "openbot-backdrop-for";
const REQUESTERS_META_SOURCE = String.raw`<meta\b[^>]*\bname\s*=\s*["']openbot-backdrop-for["'][^>]*>`;
const REQUESTER_ID_PATTERN = /^[\w.:@-]+$/u;

function isRequesterId(value: string): boolean {
  return isIdentifier(value) && REQUESTER_ID_PATTERN.test(value);
}

export function chatBackdropRequesters(html: string): string[] {
  const tag = new RegExp(REQUESTERS_META_SOURCE, "iu").exec(html)?.[0];
  const content = tag ? META_CONTENT_PATTERN.exec(tag) : null;
  const ids = (content?.[1] ?? content?.[2] ?? "").split(/\s+/u).filter(isRequesterId);
  return ids.length > 0 ? ids : [SIGNED_OUT_CHANNEL_MEMBER_ID];
}

export function withChatBackdropRequesters(html: string, ids: readonly string[]): string {
  const tags = new RegExp(REQUESTERS_META_SOURCE, "giu");
  let page = html;
  for (let next = page.replace(tags, ""); next !== page; next = page.replace(tags, "")) page = next;
  const content = ids.filter(isRequesterId).join(" ") || SIGNED_OUT_CHANNEL_MEMBER_ID;
  return withLeadingMeta(page, `<meta name="${REQUESTERS_META_NAME}" content="${content}">`);
}

export type ChatVisualTheme = Record<`--${string}`, string>;

export type ChatVisualAppearance = "dark" | "light";

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

export interface ChatVisualKey {
  key: string;
  code: string;
  metaKey: boolean;
  ctrlKey: boolean;
  shiftKey: boolean;
  altKey: boolean;
}

export interface ChatVisualRect {
  top: number;
  left: number;
  bottom: number;
  right: number;
}

export type ChatVisualMessage =
  | { type: "size"; height: number }
  | { type: "open-link"; id: number | string; url: string }
  | { type: "display-mode"; id: number | string; mode: ChatVisualDisplayMode }
  | { type: "message"; id: number | string; text: string }
  | { type: "context"; id: number | string; text: string }
  | { type: "refused"; id: number | string }
  | { type: "open-image"; src: string; name: string }
  | { type: "key"; key: ChatVisualKey }
  | { type: "selection"; text: string; rect: ChatVisualRect }
  | { type: "focused" };

export function chatVisualFrameHeight(reported?: number, requested?: number): number {
  const limit = requested !== undefined && Number.isFinite(requested) ? clampHeight(requested) : undefined;
  const height = reported !== undefined && Number.isFinite(reported) ? clampHeight(reported) : undefined;
  if (height === undefined) return limit ?? CHAT_VISUAL_DEFAULT_HEIGHT;
  return limit === undefined ? height : Math.min(limit, height);
}

function clampHeight(height: number): number {
  return Math.min(CHAT_VISUAL_MAX_HEIGHT, Math.max(CHAT_VISUAL_MIN_HEIGHT, Math.ceil(height)));
}

export function chatVisualFrameUrl(src: string, theme: ChatVisualTheme): string {
  const base = src.split("#", 1)[0] ?? src;
  return `${base}#${CHAT_VISUAL_THEME_FRAGMENT}${encodeURIComponent(JSON.stringify(theme))}`;
}

export function chatVisualThemeMessage(theme: ChatVisualTheme) {
  return {
    jsonrpc: "2.0",
    method: CHAT_VISUAL_HOST_CONTEXT_CHANGED,
    params: { theme: "dark", styles: { variables: theme } },
  } as const;
}

export function chatVisualDisplayModeMessage(mode: ChatVisualDisplayMode) {
  return {
    jsonrpc: "2.0",
    method: CHAT_VISUAL_HOST_CONTEXT_CHANGED,
    params: { displayMode: mode, availableDisplayModes: DISPLAY_MODES },
  } as const;
}

export interface ChatVisualReplyResult {
  mode?: ChatVisualDisplayMode;
}

export function chatVisualReplyMessage(id: number | string, result: ChatVisualReplyResult | null) {
  return result
    ? ({ jsonrpc: "2.0", id, result } as const)
    : ({ jsonrpc: "2.0", id, error: { code: -32000, message: "Refused" } } as const);
}

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
      if (!metaKey && !ctrlKey && key !== "Escape") return null;
      return { type: "key", key: { key, code, metaKey, ctrlKey, shiftKey, altKey } };
    }
    case CHAT_VISUAL_FOCUSED:
      return { type: "focused" };
    case CHAT_VISUAL_SELECTION_CHANGED: {
      const { text, top, left, bottom, right } = params;
      if (!isBoundedString(text, CHAT_VISUAL_CONTEXT_LIMIT)) return null;
      if (!isEdge(top) || !isEdge(left) || !isEdge(bottom) || !isEdge(right)) return null;
      return { type: "selection", text: text.trim(), rect: { top, left, bottom, right } };
    }
    default:
      return null;
  }
}

function isEdge(value: unknown): value is number {
  return isNumber(value) && Number.isFinite(value);
}

function refused(id: number | string | null): ChatVisualMessage | null {
  return id === null ? null : { type: "refused", id };
}

function requestId(id: unknown): number | string | null {
  return (isNumber(id) && Number.isFinite(id)) || isBoundedString(id, INPUT_LIMITS.identifier) ? id : null;
}

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

const BASE_STYLE = [
  ":root{color-scheme:dark;--background:transparent;--foreground:CanvasText;--muted-foreground:GrayText;",
  "--border:rgba(127,127,127,.3);--card:rgba(127,127,127,.12);--radius:12px;",
  "--font-sans:system-ui,sans-serif;--font-mono:ui-monospace,monospace;scrollbar-width:none}",
  "::-webkit-scrollbar{display:none}",
  "body{margin:0;color:var(--foreground);font:14px/1.5 var(--font-sans)}",
  "img:not(a img,button img,label img){cursor:zoom-in}",
].join("");

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
addEventListener("focus",(event)=>{if(event.isTrusted)send({method:"${CHAT_VISUAL_FOCUSED}",params:{}});});
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
const jump=(fragment)=>{
const target=document.getElementById(decodeURIComponent(fragment.slice(1)));
if(target)target.scrollIntoView();
else if(fragment.length>1)location.replace(location.href.split("#")[0]+fragment);
};
document.addEventListener("click",(event)=>{
if(event.button!==0||!(event.target instanceof Element))return;
const link=event.target.closest("a[href],area[href]");
if(!link)return;
const href=link.getAttribute("href")||"";
if(href.startsWith("#")){
event.preventDefault();
jump(href);
return;
}
if(!event.isTrusted)return;
let url;
try{url=new URL(link.getAttribute("href"),document.baseURI);}catch{return;}
if(url.hash&&url.href.split("#")[0]===location.href.split("#")[0]){
event.preventDefault();
jump(url.hash);
return;
}
if(url.protocol!=="http:"&&url.protocol!=="https:")return;
event.preventDefault();
send({id:nextId++,method:"${CHAT_VISUAL_OPEN_LINK}",params:{url:url.href}});
},true);
let selected="",reported="",selectionFrame=0;
const reportSelection=()=>{
selectionFrame=0;
const selection=getSelection();
let value="",box={top:0,left:0,bottom:0,right:0};
if(selection&&selection.rangeCount>0&&!selection.isCollapsed){
value=selection.toString().replace(/\u00a0/g," ").trim().slice(0,${CHAT_VISUAL_CONTEXT_LIMIT});
const rect=selection.getRangeAt(0).getBoundingClientRect();
if(value)box={top:rect.top,left:rect.left,bottom:rect.bottom,right:rect.right};
}
const report=value&&[value,box.top,box.left,box.bottom,box.right].join("|");
if(report===reported)return;
reported=report;
selected=value;
send({method:"${CHAT_VISUAL_SELECTION_CHANGED}",params:Object.assign({text:value},box)});
};
const scheduleSelection=()=>{if(!selectionFrame)selectionFrame=requestAnimationFrame(reportSelection);};
document.addEventListener("selectionchange",scheduleSelection);
addEventListener("scroll",()=>{if(selected)scheduleSelection();},true);
addEventListener("resize",()=>{if(selected)scheduleSelection();});
const unasked=new WeakSet(),chosen=new WeakSet(),resumed=new WeakSet(),held=new Set(),shown=new WeakMap();
const away=(media)=>{const own=media instanceof HTMLVideoElement?shown.get(media):null;return document.hidden||(own==null?shown.get(root):own)===false;};
const rest=()=>{
for(const media of held)if(!media.isConnected)held.delete(media);
for(const media of document.querySelectorAll("video,audio")){
if(!unasked.has(media))continue;
if(away(media)){if(!media.paused){held.add(media);media.pause();}}
else if(held.delete(media)&&media.paused){resumed.add(media);media.play().catch(()=>resumed.delete(media));}
}
};
const watcher=new IntersectionObserver((entries)=>{for(const entry of entries){const box=entry.boundingClientRect;shown.set(entry.target,box.width||box.height?entry.isIntersecting:null);}rest();});
watcher.observe(root);
document.addEventListener("play",(event)=>{
const media=event.target;
if(!(media instanceof HTMLMediaElement)||resumed.delete(media)||chosen.has(media))return;
if(navigator.userActivation&&navigator.userActivation.isActive){chosen.add(media);unasked.delete(media);held.delete(media);return;}
if(!unasked.has(media)){unasked.add(media);if(media instanceof HTMLVideoElement)watcher.observe(media);}
if(away(media)){held.add(media);media.pause();}
},true);
document.addEventListener("visibilitychange",rest);
})();`;

export interface ChatVisualDocumentOptions {
  theme?: ChatVisualTheme;
  appearance?: ChatVisualAppearance;
  bootstrap?: boolean;
  head?: string;
}

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
