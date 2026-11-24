import {
  X_PAGE_RULES_DEFAULT,
  X_PAYLOAD_LIMITS,
  type XPagePart,
  type XPageRules,
  type XPost,
  type XReplyPayload,
} from "@openbot/contracts/browser-extension-x";
import { decodeXRules, decodeXStatus, X_MESSAGE, type XRequest, type XStatus } from "./x-messages";

const STATE = "data-openbot-x";
const PASS = "data-openbot-x-pass";
const READY_MS = 30_000;
const NOT_READY_MS = 5_000;
const BUTTON_DEPTH = 40;

let remote: XPageRules | null = null;
let status: XStatus = { ready: false, labels: null, reason: "not-asked" };
let retry: number | undefined;
let logged = "";
let statusAt = 0;
let asking = false;
let scheduled = false;
const composers = new WeakMap<HTMLElement, Element>();

function selectors(part: XPagePart): string[] {
  return [...new Set([...(remote?.selectors[part] ?? []), ...X_PAGE_RULES_DEFAULT.selectors[part]])];
}

function queryAll(scope: ParentNode, part: XPagePart): Element[] {
  for (const selector of selectors(part)) {
    try {
      const found = [...scope.querySelectorAll(selector)];
      if (found.length) return found;
    } catch {}
  }
  return [];
}

const query = (scope: ParentNode, part: XPagePart): Element | null => queryAll(scope, part)[0] ?? null;

function closest(element: Element, part: XPagePart): Element | null {
  for (const selector of selectors(part)) {
    try {
      const found = element.closest(selector);
      if (found) return found;
    } catch {}
  }
  return null;
}

function mentions(text: string): boolean {
  const handle = remote?.mention ?? X_PAGE_RULES_DEFAULT.mention;
  return new RegExp(`(^|[^\\w@])@${handle}(?!\\w)`, "iu").test(text);
}

function withoutMention(text: string): string {
  const handle = remote?.mention ?? X_PAGE_RULES_DEFAULT.mention;
  return text
    .replace(new RegExp(`(^|[^\\w@])@${handle}(?!\\w)`, "giu"), "$1")
    .replace(/[ \t]{2,}/gu, " ")
    .trim();
}

function replyButtonFor(composer: Element): HTMLElement | null {
  let node = composer.parentElement;
  for (let depth = 0; node && depth < BUTTON_DEPTH; depth += 1, node = node.parentElement) {
    const button = query(node, "replyButton");
    if (button instanceof HTMLElement) return button;
  }
  return null;
}

async function ask<T>(message: XRequest, decode: (value: unknown) => T): Promise<T | null> {
  try {
    return decode(await chrome.runtime.sendMessage(message));
  } catch {
    return null;
  }
}

function note(text: string) {
  if (__OPENBOT_X_NOTES__) console.info(`[OpenBot] ${text}`);
}

function explain(reason: string) {
  if (reason === logged) return;
  logged = reason;
  note(reason ? `The reply button stays as X made it: ${reason}` : "The reply button has the OpenBot look.");
}

function refreshStatus() {
  if (asking || Date.now() - statusAt < (status.ready ? READY_MS : NOT_READY_MS)) return;
  asking = true;
  void ask({ kind: X_MESSAGE, action: "status" }, decodeXStatus).then((value) => {
    status = value ?? { ready: false, labels: null, reason: "extension-unavailable" };
    note(`The server check answered: ${status.ready ? "ready" : status.reason}`);
    statusAt = Date.now();
    asking = false;
    window.clearTimeout(retry);
    retry = window.setTimeout(schedule, (status.ready ? READY_MS : NOT_READY_MS) + 50);
    schedule();
  });
}

function schedule() {
  if (scheduled) return;
  scheduled = true;
  requestAnimationFrame(() => {
    scheduled = false;
    scan();
  });
}

function scan() {
  const armed = new Set<HTMLElement>();
  for (const composer of queryAll(document, "composer")) {
    if (!mentions(composer.textContent ?? "")) continue;
    refreshStatus();
    const button = replyButtonFor(composer);
    if (!button) {
      explain("the reply button selectors found nothing near the text box");
      continue;
    }
    if (!status.ready || !status.labels) {
      explain(status.reason);
      continue;
    }
    explain("");
    armed.add(button);
    composers.set(button, composer);
    if (!button.hasAttribute(STATE) || button.getAttribute(STATE) === "leaving") {
      button.setAttribute(STATE, "armed");
      button.title = status.labels.armed;
    }
  }
  for (const button of document.querySelectorAll<HTMLElement>(`[${STATE}="armed"]`))
    if (!armed.has(button)) leave(button);
}

const LEAVE_MS = 220;

function leave(button: HTMLElement) {
  button.setAttribute(STATE, "leaving");
  button.removeAttribute("title");
  const done = () => {
    if (button.getAttribute(STATE) === "leaving") reset(button);
  };
  if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) done();
  else window.setTimeout(done, LEAVE_MS);
}

function reset(button: HTMLElement) {
  button.removeAttribute(STATE);
  button.removeAttribute("title");
}

const clip = (text: string, limit: number) => (text.length > limit ? `${text.slice(0, limit - 1)}…` : text);
const webAddress = (value: string) => /^https?:\/\//u.test(value);

function readPost(element: Element): XPost {
  const author = query(element, "postAuthor");
  const authorText = author instanceof HTMLElement ? author.innerText : (author?.textContent ?? "");
  const handle = authorText.match(/@[A-Za-z0-9_]{1,15}/u)?.[0] ?? "";
  const firstLine = (authorText.split("\n")[0] ?? "").replace(handle, "").trim();
  const link = query(element, "postLink");
  const href = link instanceof HTMLAnchorElement ? link.href : "";
  const text = query(element, "postText");
  const article = query(element, "article");
  return {
    authorName: clip(firstLine, X_PAYLOAD_LIMITS.name),
    handle: clip(handle, X_PAYLOAD_LIMITS.name),
    time: clip(query(element, "postTime")?.getAttribute("datetime") ?? "", X_PAYLOAD_LIMITS.name),
    url: href.length <= X_PAYLOAD_LIMITS.url && webAddress(href) ? href : "",
    text: clip(text instanceof HTMLElement ? text.innerText : "", X_PAYLOAD_LIMITS.text),
    article: clip(article instanceof HTMLElement ? article.innerText : "", X_PAYLOAD_LIMITS.text),
    media: queryAll(element, "media")
      .map((image) => (image instanceof HTMLImageElement ? image.src : ""))
      .filter((source) => source.length <= X_PAYLOAD_LIMITS.url && webAddress(source))
      .slice(0, X_PAYLOAD_LIMITS.media),
  };
}

const before = (element: Element, other: Element) =>
  Boolean(element.compareDocumentPosition(other) & Node.DOCUMENT_POSITION_FOLLOWING);

function readPayload(composer: Element): XReplyPayload | null {
  const dialog = closest(composer, "dialog");
  const found = queryAll(dialog ?? document, "post");
  const posts = found.filter((post) => !found.some((other) => other !== post && other.contains(post)));
  const focal = dialog ? null : query(document, "focalPost");
  let replyTo = focal ? posts.indexOf(focal) : -1;
  if (replyTo < 0) replyTo = posts.findLastIndex((post) => before(post, composer));
  const target = posts[replyTo];
  if (!target) return null;
  const read = posts.map(readPost);
  const author = read[replyTo]?.handle;
  let end = replyTo + 1;
  if (!dialog && author) while (end < read.length && read[end]?.handle === author) end += 1;
  const half = Math.floor(X_PAYLOAD_LIMITS.posts / 2);
  const start = Math.max(0, replyTo - half);
  const kept = read.slice(start, Math.min(end, replyTo + half + 1));
  const message = composer instanceof HTMLElement ? composer.innerText : (composer.textContent ?? "");
  return {
    message: clip(withoutMention(message), X_PAYLOAD_LIMITS.message),
    pageUrl: location.href.length <= X_PAYLOAD_LIMITS.url ? location.href : location.origin,
    posts: kept,
    replyTo: replyTo - start,
  };
}

function sendFrom(button: HTMLElement) {
  const composer = composers.get(button);
  const payload = composer ? readPayload(composer) : null;
  if (payload) void ask({ kind: X_MESSAGE, action: "send", payload }, () => null);
  else note("The post that the reply answers was not found; X posts the reply alone.");
  post(button);
}

function post(button: HTMLElement) {
  reset(button);
  button.setAttribute(PASS, "");
  button.click();
  button.removeAttribute(PASS);
}

function armedButtonFrom(target: EventTarget | null): HTMLElement | null {
  const button = target instanceof Element ? target.closest(`[${STATE}]`) : null;
  return button instanceof HTMLElement && !button.hasAttribute(PASS) ? button : null;
}

document.addEventListener(
  "click",
  (event) => {
    const button = armedButtonFrom(event.target);
    if (!button) return;
    event.preventDefault();
    event.stopImmediatePropagation();
    if (button.getAttribute(STATE) === "armed") sendFrom(button);
  },
  true,
);
document.addEventListener(
  "keydown",
  (event) => {
    if (event.key !== "Enter" || !(event.metaKey || event.ctrlKey) || !(event.target instanceof Element)) return;
    for (const button of document.querySelectorAll<HTMLElement>(`[${STATE}]`)) {
      if (!composers.get(button)?.contains(event.target)) continue;
      event.preventDefault();
      event.stopImmediatePropagation();
      if (button.getAttribute(STATE) === "armed") sendFrom(button);
      return;
    }
  },
  true,
);

function start() {
  new MutationObserver(schedule).observe(document.body, { childList: true, subtree: true, characterData: true });
  document.addEventListener("input", schedule, true);
  schedule();
}

note("The script runs on this page.");
start();
void ask({ kind: X_MESSAGE, action: "rules" }, decodeXRules).then((value) => {
  remote = value;
  note(value ? "It uses the served selectors." : "It uses the built-in selectors.");
  schedule();
});
