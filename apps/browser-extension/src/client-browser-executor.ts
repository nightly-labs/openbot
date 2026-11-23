import { type DynamicRecord, isBoolean, isDynamicRecord, isNumber, isString } from "@openbot/contracts/runtime-values";
import {
  CLIENT_BROWSER_LIMITS,
  type ClientBrowserCommand,
  type ClientBrowserFailureCode,
  type ClientBrowserResult,
  type ClientBrowserTarget,
  type ClientTab,
} from "@openbot/contracts/team-protocol/client-browser-v1";
import type { AskKind } from "./client-browser-messages";

const ATTACH_IDLE_MS = 30_000;
const LOAD_WAIT_MS = 15_000;
const SCREENSHOT_WAIT_MS = 15_000;
const SNAPSHOT_TEXT = 40_000;
const SNAPSHOT_ELEMENTS = 400;

export class BrowserCommandError extends Error {
  constructor(
    readonly code: ClientBrowserFailureCode,
    message: string,
  ) {
    super(message);
  }
}

export interface CommandContext {
  groupId: number | null;
  allow: (kind: AskKind, url: string, detail: string) => Promise<void>;
  addToGroup: (tabId: number) => Promise<void>;
  watchDownloads: (url: string, allowed: boolean, action: () => Promise<void>) => Promise<string[]>;
  workingLabel: string;
}

interface Attached {
  idle: ReturnType<typeof setTimeout> | undefined;
}

const attached = new Map<number, Attached>();
let workingLabel = "";
let groupTab: (tabId: number) => Promise<void> = async () => undefined;
const revisions = new Map<number, number>();

export const isWebUrl = (url: string | undefined): url is string => Boolean(url && /^https?:\/\//iu.test(url));

function looksLikeGrant(url: string | undefined): boolean {
  if (!url || !URL.canParse(url)) return false;
  const parsed = new URL(url);
  return /authori[sz]e|oauth/iu.test(parsed.pathname) && parsed.searchParams.has("client_id");
}

export function clientTab(tab: chrome.tabs.Tab): ClientTab | null {
  if (tab.id === undefined) return null;
  return {
    id: String(tab.id),
    url: (tab.url ?? "").slice(0, CLIENT_BROWSER_LIMITS.url),
    title: (tab.title ?? "").slice(0, CLIENT_BROWSER_LIMITS.title),
    active: tab.active,
  };
}

export function installExecutor(): void {
  chrome.debugger.onDetach.addListener((source) => {
    if (source.tabId !== undefined) forget(source.tabId);
  });
  chrome.tabs.onRemoved.addListener((tabId) => {
    forget(tabId);
    revisions.delete(tabId);
  });
}

const worlds = new Map<number, number>();

function forget(tabId: number): void {
  clearTimeout(attached.get(tabId)?.idle);
  attached.delete(tabId);
  worlds.delete(tabId);
}

function errorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

type ProtocolParams = chrome.debugger.Params;

async function send(tabId: number, method: string, params?: ProtocolParams): Promise<DynamicRecord> {
  let answer: unknown;
  try {
    answer = await chrome.debugger.sendCommand({ tabId }, method, params);
  } catch (error) {
    throw new BrowserCommandError("failed", `${method} failed: ${errorText(error)}`);
  }
  return isDynamicRecord(answer) ? answer : {};
}

async function attach(tabId: number): Promise<Attached> {
  await groupTab(tabId).catch(() => undefined);
  let entry = attached.get(tabId);
  if (!entry) {
    await chrome.debugger.attach({ tabId }, "1.3").catch((error: unknown) => {
      throw new BrowserCommandError("failed", `Chrome could not attach to the tab: ${errorText(error)}`);
    });
    entry = { idle: undefined };
    attached.set(tabId, entry);
    await send(tabId, "Page.enable");
  }
  clearTimeout(entry.idle);
  entry.idle = undefined;
  await overlay(tabId, { step: "show", label: workingLabel, x: 0, y: 0 });
  return entry;
}

type OverlayInput = Parameters<typeof pageOverlay>[0];

async function overlay(tabId: number, input: OverlayInput): Promise<void> {
  await inPage(tabId, pageOverlay, input).catch(() => undefined);
}

function release(tabId: number): void {
  const entry = attached.get(tabId);
  if (!entry) return;
  clearTimeout(entry.idle);
  entry.idle = setTimeout(() => void detach(tabId), ATTACH_IDLE_MS);
}

async function detach(tabId: number): Promise<void> {
  if (attached.has(tabId)) await overlay(tabId, { step: "remove", label: "", x: 0, y: 0 });
  forget(tabId);
  await chrome.debugger.detach({ tabId }).catch(() => undefined);
}

export async function detachAll(): Promise<void> {
  for (const tabId of [...attached.keys()]) await detach(tabId);
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

async function world(tabId: number, fresh: boolean): Promise<number> {
  const kept = worlds.get(tabId);
  if (!fresh && kept !== undefined) return kept;
  const tree = await send(tabId, "Page.getFrameTree");
  const frame = isDynamicRecord(tree.frameTree) ? tree.frameTree.frame : null;
  if (!isDynamicRecord(frame) || !isString(frame.id))
    throw new BrowserCommandError("failed", "The page has no frame yet.");
  const created = await send(tabId, "Page.createIsolatedWorld", { frameId: frame.id, worldName: "openbot" });
  if (!isNumber(created.executionContextId))
    throw new BrowserCommandError("failed", "Chrome did not make a script context for the page.");
  worlds.set(tabId, created.executionContextId);
  return created.executionContextId;
}

async function inPage<I>(tabId: number, script: (input: I) => object, input: I): Promise<DynamicRecord> {
  const evaluate = async (fresh: boolean) =>
    send(tabId, "Runtime.evaluate", {
      expression: `(${script.toString()})(${JSON.stringify(input)})`,
      contextId: await world(tabId, fresh),
      returnByValue: true,
      awaitPromise: true,
    });
  const answer = await evaluate(false).catch(() => evaluate(true));
  if (isDynamicRecord(answer.exceptionDetails)) {
    const detail = isString(answer.exceptionDetails.text) ? answer.exceptionDetails.text : "";
    throw new BrowserCommandError("failed", `The page script failed. ${detail}`.trim());
  }
  const value = isDynamicRecord(answer.result) ? answer.result.value : null;
  if (!isDynamicRecord(value)) throw new BrowserCommandError("failed", "The page did not answer.");
  return value;
}

async function waitForLoad(tabId: number): Promise<chrome.tabs.Tab> {
  const deadline = Date.now() + LOAD_WAIT_MS;
  await sleep(250);
  for (;;) {
    const tab = await chrome.tabs.get(tabId).catch(() => null);
    if (!tab) throw new BrowserCommandError("not-found", "The tab closed.");
    if (tab.status !== "loading" || Date.now() > deadline) return tab;
    await sleep(200);
  }
}

async function sharedTab(tabId: string): Promise<{ id: number; tab: chrome.tabs.Tab }> {
  const id = Number(tabId);
  const tab = Number.isSafeInteger(id) ? await chrome.tabs.get(id).catch(() => null) : null;
  if (!tab) throw new BrowserCommandError("not-found", "The tab is closed.");
  if (!isWebUrl(tab.url)) throw new BrowserCommandError("failed", "Agents can use only web pages (http and https).");
  return { id, tab };
}

function result(text: string, tab: chrome.tabs.Tab | null, image: string | null = null): ClientBrowserResult {
  return { text: text.slice(0, CLIENT_BROWSER_LIMITS.resultText), image, tab: tab ? clientTab(tab) : null };
}

function targetWords(target: ClientBrowserTarget): string {
  if ("ref" in target) return `[${target.ref}]`;
  if ("css" in target) return target.css;
  if ("text" in target) return `"${target.text}"`;
  return `(${target.x}, ${target.y})`;
}

export async function runCommand(command: ClientBrowserCommand, context: CommandContext): Promise<ClientBrowserResult> {
  workingLabel = context.workingLabel;
  if (command.kind === "open") return openTab(command.url, context);
  groupTab = context.addToGroup;
  const { id, tab } = await sharedTab(command.tabId);
  const url = tab.url ?? "";
  try {
    switch (command.kind) {
      case "navigate":
        return await navigate(id, url, command, context);
      case "snapshot":
        await context.allow("site", url, "");
        return await snapshot(id);
      case "screenshot":
        await context.allow("site", url, "");
        return await screenshot(id, tab);
      case "click":
        return await click(id, url, command.target, context);
      case "type":
        return await typeText(id, url, command, context);
      case "press":
        await context.allow("site", url, command.key);
        if (looksLikeGrant(url)) await context.allow("sign-in", url, command.key);
        await attach(id);
        if (typesText(command.key)) {
          const focused = await inPage(id, focusedField, {});
          if (focused.password === true) await context.allow("password", url, command.key);
          else if (focused.payment === true || (await focusInClosedShadow(id)))
            await context.allow("payment", url, command.key);
        }
        await pressKey(id, command.key);
        return result(`Pressed ${command.key}.`, await waitForLoad(id));
      case "scroll":
        await context.allow("site", url, "");
        return await scroll(id, command.deltaX, command.deltaY);
      case "wait_for":
        if ("ms" in command) {
          await sleep(command.ms);
          return result(`Waited ${Math.round(command.ms)} ms.`, await chrome.tabs.get(id));
        }
        await context.allow("site", url, "");
        return await waitForText(id, command.text);
      case "close_tab":
        await context.allow("site", url, "");
        await chrome.tabs.remove(id);
        return result("Closed the tab.", null);
    }
  } finally {
    release(id);
  }
}

async function openTab(url: string, context: CommandContext): Promise<ClientBrowserResult> {
  await context.allow("site", url, url);
  if (looksLikeGrant(url)) await context.allow("sign-in", url, url);
  const group = context.groupId === null ? null : await chrome.tabGroups.get(context.groupId).catch(() => null);
  const created = await chrome.tabs.create(
    group ? { url, windowId: group.windowId, active: true } : { url, active: true },
  );
  if (created.id === undefined) throw new BrowserCommandError("failed", "Chrome did not open the tab.");
  await context.addToGroup(created.id);
  const tab = await waitForLoad(created.id);
  return result(`Opened ${tab.url ?? url} in a new tab of the OpenBot group.`, tab);
}

async function navigate(
  id: number,
  url: string,
  command: Extract<ClientBrowserCommand, { kind: "navigate" }>,
  context: CommandContext,
): Promise<ClientBrowserResult> {
  if ("url" in command) {
    await context.allow("site", url, command.url);
    await context.allow("site", command.url, command.url);
    if (looksLikeGrant(command.url)) await context.allow("sign-in", command.url, command.url);
    await chrome.tabs.update(id, { url: command.url });
  } else {
    await context.allow("site", url, command.direction);
    if (command.direction === "back") await chrome.tabs.goBack(id);
    else if (command.direction === "forward") await chrome.tabs.goForward(id);
    else await chrome.tabs.reload(id);
  }
  const tab = await waitForLoad(id);
  return result(`The tab is at ${tab.url ?? ""}. Title: ${tab.title ?? ""}`, tab);
}

async function snapshot(id: number): Promise<ClientBrowserResult> {
  await attach(id);
  const value = await inPage(id, pageSnapshot, {
    text: SNAPSHOT_TEXT,
    elements: SNAPSHOT_ELEMENTS,
    interactive: INTERACTIVE,
  });
  if (
    !isString(value.title) ||
    !isString(value.url) ||
    !isString(value.elements) ||
    !isString(value.text) ||
    !isNumber(value.scrollY) ||
    !isNumber(value.height) ||
    !isNumber(value.viewport)
  )
    throw new BrowserCommandError("failed", "The page gave no snapshot.");
  const revision = (revisions.get(id) ?? 0) + 1;
  revisions.set(id, revision);
  const text = [
    `Title: ${value.title}`,
    `URL: ${value.url}`,
    `Snapshot revision: ${revision}. A ref target: {"kind":"ref","ref":"e1","revision":${revision}}.`,
    `Scroll: ${value.scrollY} of ${Math.max(0, value.height - value.viewport)} px.`,
    "",
    "Interactive elements:",
    value.elements || "(none)",
    "",
    "Page text:",
    value.text,
  ].join("\n");
  return result(text, await chrome.tabs.get(id));
}

async function viewport(id: number): Promise<{ x: number; y: number; width: number; height: number; page: number }> {
  const value = await inPage(id, pageViewport, null);
  if (
    !isNumber(value.x) ||
    !isNumber(value.y) ||
    !isNumber(value.width) ||
    !isNumber(value.height) ||
    !isNumber(value.page)
  )
    throw new BrowserCommandError("failed", "The page did not give its size.");
  return { x: value.x, y: value.y, width: value.width, height: value.height, page: value.page };
}

async function screenshot(id: number, tab: chrome.tabs.Tab): Promise<ClientBrowserResult> {
  if (!tab.active) await chrome.tabs.update(id, { active: true });
  await attach(id);
  const size = await viewport(id);
  await overlay(id, { step: "hide", label: "", x: 0, y: 0 });
  try {
    return await capture(id, size);
  } finally {
    await overlay(id, { step: "show", label: workingLabel, x: 0, y: 0 });
  }
}

async function capture(
  id: number,
  size: { x: number; y: number; width: number; height: number },
): Promise<ClientBrowserResult> {
  for (const step of [
    { quality: 70, scale: 1 },
    { quality: 50, scale: 1 },
    { quality: 50, scale: 0.6 },
    { quality: 40, scale: 0.4 },
  ]) {
    const params: ProtocolParams =
      step.scale === 1
        ? { format: "jpeg", quality: step.quality }
        : {
            format: "jpeg",
            quality: step.quality,
            clip: { x: size.x, y: size.y, width: size.width, height: size.height, scale: step.scale },
          };
    const answer = await Promise.race([
      send(id, "Page.captureScreenshot", params),
      sleep(SCREENSHOT_WAIT_MS).then(() => {
        throw new BrowserCommandError("failed", "The tab did not paint. Ask the person to show the tab.");
      }),
    ]);
    const data = isString(answer.data) ? answer.data : "";
    if (data && data.length <= CLIENT_BROWSER_LIMITS.image) {
      const scaled = step.scale === 1 ? "" : `, scaled to ${Math.round(step.scale * 100)} %`;
      return result(
        `Screenshot of the visible page, ${size.width}×${size.height} CSS px${scaled}.`,
        await chrome.tabs.get(id),
        data,
      );
    }
  }
  throw new BrowserCommandError("failed", "The screenshot is too large.");
}

interface Located {
  x: number;
  y: number;
  label: string;
  href: string;
  download: boolean;
  password: boolean;
  payment: boolean;
}

async function locate(id: number, target: ClientBrowserTarget, focus: boolean): Promise<Located> {
  const value = await inPage(id, pageLocate, { target, focus, interactive: INTERACTIVE });
  if (value.found !== true)
    throw new BrowserCommandError(
      "failed",
      isString(value.reason) ? value.reason : `No element matches ${targetWords(target)}. Take a new snapshot.`,
    );
  const { x, y, label, href, download, password, payment } = value;
  if (
    !isNumber(x) ||
    !isNumber(y) ||
    !isString(label) ||
    !isString(href) ||
    !isBoolean(download) ||
    !isBoolean(password) ||
    !isBoolean(payment)
  )
    throw new BrowserCommandError("failed", "The page did not answer.");
  return { x, y, label, href, download, password, payment };
}

async function mouseClick(id: number, x: number, y: number): Promise<void> {
  await send(id, "Input.dispatchMouseEvent", { type: "mouseMoved", x, y });
  await send(id, "Input.dispatchMouseEvent", { type: "mousePressed", x, y, button: "left", buttons: 1, clickCount: 1 });
  await send(id, "Input.dispatchMouseEvent", {
    type: "mouseReleased",
    x,
    y,
    button: "left",
    buttons: 0,
    clickCount: 1,
  });
}

async function click(
  id: number,
  url: string,
  target: ClientBrowserTarget,
  context: CommandContext,
): Promise<ClientBrowserResult> {
  await context.allow("site", url, targetWords(target));
  await attach(id);
  const found = await locate(id, target, false);
  if (looksLikeGrant(url) || looksLikeGrant(found.href)) await context.allow("sign-in", url, found.label);
  if (found.download) await context.allow("download", url, found.href || found.label);
  await overlay(id, { step: "click", label: workingLabel, x: found.x, y: found.y });
  const downloads = await context.watchDownloads(url, found.download, () => mouseClick(id, found.x, found.y));
  const tab = await waitForLoad(id);
  const moved = tab.url && tab.url !== url ? ` The tab is now at ${tab.url}.` : "";
  const files = downloads.length ? ` ${downloads.join(" ")}` : "";
  return result(`Clicked ${found.label}.${moved}${files}`, tab);
}

async function typeText(
  id: number,
  url: string,
  command: Extract<ClientBrowserCommand, { kind: "type" }>,
  context: CommandContext,
): Promise<ClientBrowserResult> {
  await context.allow("site", url, targetWords(command.target));
  await attach(id);
  const found = await locate(id, command.target, false);
  if (found.password) await context.allow("password", url, found.label);
  else if (found.payment) await context.allow("payment", url, found.label);
  if (looksLikeGrant(url)) await context.allow("sign-in", url, found.label);
  await overlay(id, { step: "point", label: workingLabel, x: found.x, y: found.y });
  await locate(id, command.target, true);
  if (command.text) await send(id, "Input.insertText", { text: command.text });
  else await pressKey(id, "Backspace");
  if (command.submit) await pressKey(id, "Enter");
  const tab = command.submit ? await waitForLoad(id) : await chrome.tabs.get(id);
  return result(
    `Typed ${command.text.length} characters into ${found.label}${command.submit ? " and pressed Enter" : ""}.`,
    tab,
  );
}

async function scroll(id: number, deltaX: number, deltaY: number): Promise<ClientBrowserResult> {
  await attach(id);
  const before = await viewport(id);
  await send(id, "Input.dispatchMouseEvent", {
    type: "mouseWheel",
    x: Math.round(before.width / 2),
    y: Math.round(before.height / 2),
    deltaX,
    deltaY,
  });
  await sleep(300);
  const after = await viewport(id);
  return result(
    `Scrolled to ${Math.round(after.y)} of ${Math.max(0, Math.round(after.page - after.height))} px.`,
    await chrome.tabs.get(id),
  );
}

async function waitForText(id: number, text: string): Promise<ClientBrowserResult> {
  await attach(id);
  const deadline = Date.now() + CLIENT_BROWSER_LIMITS.waitMs;
  for (;;) {
    if ((await inPage(id, pageHasText, text)).found === true)
      return result(`The page shows "${text}".`, await chrome.tabs.get(id));
    if (Date.now() > deadline) throw new BrowserCommandError("failed", `The page did not show "${text}" in 30 s.`);
    await sleep(250);
  }
}

const NAMED_KEYS: Record<string, { code: string; keyCode: number; text?: string }> = {
  Enter: { code: "Enter", keyCode: 13, text: "\r" },
  Tab: { code: "Tab", keyCode: 9 },
  Escape: { code: "Escape", keyCode: 27 },
  Backspace: { code: "Backspace", keyCode: 8 },
  Delete: { code: "Delete", keyCode: 46 },
  ArrowUp: { code: "ArrowUp", keyCode: 38 },
  ArrowDown: { code: "ArrowDown", keyCode: 40 },
  ArrowLeft: { code: "ArrowLeft", keyCode: 37 },
  ArrowRight: { code: "ArrowRight", keyCode: 39 },
  Home: { code: "Home", keyCode: 36 },
  End: { code: "End", keyCode: 35 },
  PageUp: { code: "PageUp", keyCode: 33 },
  PageDown: { code: "PageDown", keyCode: 34 },
  Space: { code: "Space", keyCode: 32, text: " " },
};
const MODIFIERS: Record<string, number> = { Alt: 1, Control: 2, Ctrl: 2, Meta: 4, Cmd: 4, Shift: 8 };

function typesText(key: string): boolean {
  const main = key.split("+").pop() || "+";
  const named = NAMED_KEYS[main === " " ? "Space" : main];
  return named ? named.text !== undefined : true;
}

async function focusInClosedShadow(tabId: number): Promise<boolean> {
  const focused = await send(tabId, "Runtime.evaluate", {
    expression:
      "(() => { let field = document.activeElement; while (field?.shadowRoot?.activeElement) field = field.shadowRoot.activeElement; return field; })()",
    contextId: await world(tabId, false),
  });
  const objectId = isDynamicRecord(focused.result) ? focused.result.objectId : null;
  if (!isString(objectId)) return false;
  const described = await send(tabId, "DOM.describeNode", { objectId, depth: 1, pierce: true }).catch(() => null);
  const roots = described && isDynamicRecord(described.node) ? described.node.shadowRoots : null;
  return Array.isArray(roots) && roots.some((root) => isDynamicRecord(root) && root.shadowRootType === "closed");
}

function focusedField() {
  let field = document.activeElement;
  while (field?.shadowRoot?.activeElement) field = field.shadowRoot.activeElement;
  const tokens = (field?.getAttribute("autocomplete") ?? "").split(/\s+/);
  const opaque =
    field instanceof HTMLIFrameElement || field instanceof HTMLFrameElement || field instanceof HTMLObjectElement;
  return {
    password: field instanceof HTMLInputElement && field.type === "password",
    payment: opaque || tokens.some((token) => token.startsWith("cc-")),
  };
}

async function pressKey(id: number, key: string): Promise<void> {
  const parts = key.split("+");
  const main = parts.pop() || "+";
  let modifiers = 0;
  for (const part of parts) {
    const bit = MODIFIERS[part];
    if (bit === undefined) throw new BrowserCommandError("failed", `Unknown modifier: ${part}.`);
    modifiers |= bit;
  }
  const named = NAMED_KEYS[main === " " ? "Space" : main];
  let event: { key: string; code: string; keyCode: number; text?: string };
  if (named) event = { key: main === "Space" ? " " : main, ...named };
  else if ([...main].length === 1) {
    const upper = main.toUpperCase();
    const letter = /^[A-Z]$/u.test(upper);
    const digit = /^\d$/u.test(main);
    const code = letter ? `Key${upper}` : digit ? `Digit${main}` : "";
    event = { key: main, code, keyCode: letter || digit ? upper.charCodeAt(0) : 0, text: main };
  } else throw new BrowserCommandError("failed", `Unknown key: ${main}.`);
  const text = modifiers & (2 | 4) ? undefined : event.text;
  const base = { modifiers, key: event.key, code: event.code, windowsVirtualKeyCode: event.keyCode };
  await send(id, "Input.dispatchKeyEvent", text ? { ...base, type: "keyDown", text } : { ...base, type: "rawKeyDown" });
  await send(id, "Input.dispatchKeyEvent", { ...base, type: "keyUp" });
}

const INTERACTIVE =
  "a[href], button, input:not([type=hidden]), select, textarea, summary, [role=button], [role=link], [role=checkbox], [role=radio], [role=tab], [role=menuitem], [role=option], [role=switch], [role=textbox], [role=combobox], [role=searchbox], [contenteditable=''], [contenteditable=true]";

function pageSnapshot(input: { text: number; elements: number; interactive: string }) {
  const clean = (value: string, max: number) => {
    const text = value.replace(/\s+/g, " ").trim();
    return text.length > max ? `${text.slice(0, max - 1)}…` : text;
  };
  const refs = new Map<string, WeakRef<Element>>();
  globalThis.openbotRefs = refs;
  const lines: string[] = [];
  let count = 0;
  for (const element of document.querySelectorAll(input.interactive)) {
    if (count >= input.elements) break;
    if (!(element instanceof HTMLElement)) continue;
    const box = element.getBoundingClientRect();
    const style = getComputedStyle(element);
    if (box.width < 1 || box.height < 1 || style.visibility === "hidden" || style.display === "none") continue;
    count += 1;
    const ref = `e${count}`;
    refs.set(ref, new WeakRef(element));
    const field = element instanceof HTMLInputElement ? element : null;
    const tag = element.tagName.toLowerCase();
    const role = element.getAttribute("role") ?? (tag === "a" ? "link" : field ? `input ${field.type}` : tag);
    const tokens = (element.getAttribute("autocomplete") ?? "").split(/\s+/);
    const password = field?.type === "password";
    const payment = tokens.some((token) => token.startsWith("cc-"));
    const name = clean(
      element.getAttribute("aria-label") ||
        (field?.labels?.[0]?.innerText ?? "") ||
        element.innerText ||
        element.getAttribute("placeholder") ||
        element.getAttribute("title") ||
        (field && (field.type === "submit" || field.type === "button") ? field.value : ""),
      120,
    );
    let value = "";
    if (field && !password && !payment && field.type !== "submit" && field.type !== "button") {
      value = field.type === "checkbox" || field.type === "radio" ? "" : clean(field.value, 80);
    } else if (element instanceof HTMLTextAreaElement && !payment) value = clean(element.value, 80);
    else if (element instanceof HTMLSelectElement) value = clean(element.selectedOptions[0]?.text ?? "", 80);
    const flags = [
      password ? "password field" : "",
      payment ? "payment field" : "",
      field?.checked ? "checked" : "",
      element.matches(":disabled") ? "disabled" : "",
    ].filter(Boolean);
    const href = element instanceof HTMLAnchorElement ? ` -> ${element.href.slice(0, 200)}` : "";
    lines.push(
      `[${ref}] ${role} "${name}"${value ? ` value="${value}"` : ""}${flags.length ? ` (${flags.join(", ")})` : ""}${href}`,
    );
  }
  const text = (document.body?.innerText ?? "").replace(/\n{3,}/g, "\n\n").trim();
  return {
    title: document.title,
    url: location.href,
    elements: lines.join("\n"),
    text: text.length > input.text ? `${text.slice(0, input.text)}…` : text,
    scrollY: Math.round(window.scrollY),
    height: document.documentElement.scrollHeight,
    viewport: window.innerHeight,
  };
}

async function pageOverlay(input: {
  step: "show" | "hide" | "remove" | "point" | "click";
  label: string;
  x: number;
  y: number;
}) {
  const TAG = "openbot-agent-overlay";
  const ACCENT = "214 173 242";
  const EDGE = "217 138 201";
  const INK = "#040007";
  const LIFE_MS = 36_000;
  const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  let host = document.querySelector<HTMLElement>(TAG);
  if (input.step === "remove") {
    host?.remove();
    return { done: true };
  }
  if (!host) {
    host = document.createElement(TAG);
    Object.assign(host.style, { position: "fixed", inset: "0", zIndex: "2147483647", pointerEvents: "none" });
    const root = host.attachShadow({ mode: "open" });
    const glow = document.createElement("div");
    Object.assign(glow.style, {
      position: "fixed",
      inset: "0",
      backgroundImage: ["to right", "to left", "to bottom", "to top"]
        .map((side) => `linear-gradient(${side}, rgb(${EDGE} / 0.42), rgb(${ACCENT} / 0.14) 28px, transparent 72px)`)
        .join(", "),
    });
    if (!reduced)
      glow.animate([{ opacity: 1 }, { opacity: 0.7 }, { opacity: 1 }], {
        duration: 2600,
        easing: "ease-in-out",
        iterations: Infinity,
      });
    const pill = document.createElement("div");
    Object.assign(pill.style, {
      position: "fixed",
      top: "10px",
      left: "50%",
      transform: "translateX(-50%)",
      display: "flex",
      alignItems: "center",
      gap: "8px",
      maxWidth: "calc(100vw - 32px)",
      padding: "6px 12px 6px 10px",
      borderRadius: "999px",
      background: "rgb(24 24 27 / 0.92)",
      color: "#ffffff",
      font: "500 13px/1.2 system-ui, -apple-system, sans-serif",
      whiteSpace: "nowrap",
      boxShadow: "0 4px 16px rgb(0 0 0 / 0.25)",
    });
    const dot = document.createElement("span");
    Object.assign(dot.style, {
      width: "8px",
      height: "8px",
      flex: "none",
      borderRadius: "50%",
      background: `rgb(${ACCENT})`,
    });
    if (!reduced)
      dot.animate([{ opacity: 1 }, { opacity: 0.35 }, { opacity: 1 }], { duration: 1400, iterations: Infinity });
    const label = document.createElement("span");
    label.id = "label";
    Object.assign(label.style, { overflow: "hidden", textOverflow: "ellipsis" });
    pill.append(dot, label);
    const svg = "http://www.w3.org/2000/svg";
    const cursor = document.createElementNS(svg, "svg");
    cursor.id = "cursor";
    cursor.setAttribute("width", "24");
    cursor.setAttribute("height", "24");
    cursor.setAttribute("viewBox", "0 0 24 24");
    Object.assign(cursor.style, {
      position: "fixed",
      left: "0",
      top: "0",
      display: "none",
      filter: "drop-shadow(0 2px 3px rgb(0 0 0 / 0.35))",
    });
    const arrow = document.createElementNS(svg, "path");
    arrow.setAttribute("d", "M3 2 L20 11.2 L12.6 12.9 L9.2 20 Z");
    arrow.setAttribute("fill", `rgb(${ACCENT})`);
    arrow.setAttribute("stroke", INK);
    arrow.setAttribute("stroke-width", "1.6");
    arrow.setAttribute("stroke-linejoin", "round");
    cursor.append(arrow);
    root.append(glow, pill, cursor);
    document.documentElement.append(host);
    if (!reduced) host.animate([{ opacity: 0 }, { opacity: 1 }], { duration: 200, easing: "ease-out" });
  }
  const root = host.shadowRoot;
  if (!root) return { done: false };
  host.style.display = input.step === "hide" ? "none" : "block";
  if (input.step === "hide") return { done: true };
  const label = root.getElementById("label");
  if (label && input.label) label.textContent = input.label;
  for (const animation of host.getAnimations()) if (animation.id === "life") animation.cancel();
  const life = host.animate([{ opacity: 1 }, { opacity: 1, offset: 0.98 }, { opacity: 0 }], {
    duration: LIFE_MS,
    fill: "forwards",
  });
  life.id = "life";
  if (input.step === "show") return { done: true };
  const cursor = root.getElementById("cursor");
  if (!(cursor instanceof SVGElement)) return { done: false };
  const to = `translate(${input.x - 3}px, ${input.y - 2}px)`;
  const from =
    cursor.style.display === "none"
      ? `translate(${input.x - 3 - 60}px, ${input.y - 2 + 40}px)`
      : cursor.style.transform;
  cursor.style.display = "block";
  cursor.style.transform = to;
  if (!reduced && from !== to)
    await cursor
      .animate([{ transform: from }, { transform: to }], { duration: 350, easing: "cubic-bezier(0.22, 1, 0.36, 1)" })
      .finished.catch(() => undefined);
  if (input.step === "click") {
    const ripple = document.createElement("div");
    Object.assign(ripple.style, {
      position: "fixed",
      left: `${input.x - 14}px`,
      top: `${input.y - 14}px`,
      width: "28px",
      height: "28px",
      borderRadius: "50%",
      border: `2px solid rgb(${ACCENT})`,
      background: `rgb(${ACCENT} / 0.3)`,
      boxShadow: `0 0 0 1px ${INK}`,
    });
    root.append(ripple);
    const press = reduced
      ? ripple.animate([{ opacity: 1 }, { opacity: 0 }], { duration: 300 })
      : ripple.animate(
          [
            { transform: "scale(0.3)", opacity: 1 },
            { transform: "scale(1.6)", opacity: 0 },
          ],
          { duration: 450, easing: "cubic-bezier(0.22, 1, 0.36, 1)" },
        );
    press.onfinish = () => ripple.remove();
  }
  return { done: true };
}

function pageViewport(_input: null) {
  return {
    x: window.scrollX,
    y: window.scrollY,
    width: window.innerWidth,
    height: window.innerHeight,
    page: document.documentElement.scrollHeight,
  };
}

function pageHasText(text: string) {
  return { found: (document.body?.innerText ?? "").toLowerCase().includes(text.toLowerCase()) };
}

function pageLocate(input: { target: ClientBrowserTarget; focus: boolean; interactive: string }) {
  const { target } = input;
  const visible = (element: Element) => {
    const box = element.getBoundingClientRect();
    const style = getComputedStyle(element);
    return box.width >= 1 && box.height >= 1 && style.visibility !== "hidden" && style.display !== "none";
  };
  const nameOf = (element: Element) =>
    (
      element.getAttribute("aria-label") ||
      (element instanceof HTMLElement ? element.innerText : "") ||
      (element instanceof HTMLInputElement ? element.value || element.placeholder : "") ||
      element.getAttribute("title") ||
      ""
    )
      .replace(/\s+/g, " ")
      .trim();
  let element: Element | null = null;
  if ("ref" in target) {
    const found = globalThis.openbotRefs?.get(target.ref)?.deref();
    element = found?.isConnected ? found : null;
  } else if ("css" in target) {
    try {
      element = document.querySelector(target.css);
    } catch {
      return { found: false, reason: "The CSS selector is not valid." };
    }
  } else if ("text" in target) {
    const wanted = target.text.replace(/\s+/g, " ").trim().toLowerCase();
    let loose: Element | null = null;
    for (const candidate of document.querySelectorAll(input.interactive)) {
      if (!visible(candidate)) continue;
      const name = nameOf(candidate).toLowerCase();
      if (name === wanted) {
        element = candidate;
        break;
      }
      if (!loose && name.includes(wanted)) loose = candidate;
    }
    element ??= loose;
    if (!element && document.body) {
      const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
      for (let node = walker.nextNode(); node; node = walker.nextNode()) {
        const parent = node.parentElement;
        if (parent && visible(parent) && (node.textContent ?? "").toLowerCase().includes(wanted)) {
          element = parent.closest(input.interactive) ?? parent;
          break;
        }
      }
    }
  } else {
    element = document.elementFromPoint(target.x, target.y);
    while (element?.shadowRoot) {
      const inner = element.shadowRoot.elementFromPoint(target.x, target.y);
      if (!inner || inner === element) break;
      element = inner;
    }
  }
  if (!element) return { found: false };
  const fields = "input, textarea, select, [contenteditable=''], [contenteditable=true]";
  let field = element.matches(fields) ? element : (element.querySelector(fields) ?? element.closest(fields) ?? element);
  while (!field.matches(fields) && field.shadowRoot) {
    const inner = field.shadowRoot.querySelector(fields);
    if (!inner) break;
    field = inner;
  }
  const opaque = (node: Element) =>
    node instanceof HTMLIFrameElement ||
    node instanceof HTMLFrameElement ||
    node instanceof HTMLObjectElement ||
    (!field.matches(fields) && node.tagName.includes("-") && !node.shadowRoot);
  const tokens = (field.getAttribute("autocomplete") ?? "").split(/\s+/);
  const link = element.closest("a[href]");
  let x = 0;
  let y = 0;
  if ("x" in target) {
    x = target.x;
    y = target.y;
  } else {
    element.scrollIntoView({ block: "center", inline: "center" });
    const box = element.getBoundingClientRect();
    x = box.left + box.width / 2;
    y = box.top + box.height / 2;
  }
  if (input.focus && field instanceof HTMLElement) {
    field.focus();
    if (field instanceof HTMLInputElement || field instanceof HTMLTextAreaElement) field.select();
    else if (field.isContentEditable) {
      const range = document.createRange();
      range.selectNodeContents(field);
      const selection = window.getSelection();
      selection?.removeAllRanges();
      selection?.addRange(range);
    }
  }
  const role = element.getAttribute("role") ?? element.tagName.toLowerCase();
  const name = nameOf(element).slice(0, 80);
  return {
    found: true,
    x: Math.round(x),
    y: Math.round(y),
    label: name ? `${role} "${name}"` : role,
    href: link instanceof HTMLAnchorElement ? link.href : "",
    download: link instanceof HTMLAnchorElement && link.hasAttribute("download"),
    password: field instanceof HTMLInputElement && field.type === "password",
    payment: [element, field].some(opaque) || tokens.some((token) => token.startsWith("cc-")),
  };
}
