import assert from "node:assert/strict";
import { mkdirSync } from "node:fs";
import { resolve } from "node:path";
import { translateFor } from "@openbot/i18n";
import type { RemoteRequestRecord } from "@openbot/team-client/sync-profile";
import type { BrowserContext, Page } from "playwright-core";
import { WAIT_MS } from "./channel-e2e-support";

export const DEV_HOST_EMAIL = "openbot-dev-host@example.com";
const english = translateFor("en");

declare global {
  interface Window {
    __syncPerfPeers?: RTCPeerConnection[];
    __syncPerfSink?: { records: RemoteRequestRecord[]; open: number };
  }
}

export const literal = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

export async function signInDevHost(page: Page, api: string, out: string): Promise<void> {
  await page.goto(`${api}/app`);
  await page.getByRole("textbox", { name: english("account.login.email"), exact: true }).fill(DEV_HOST_EMAIL);
  const send = page.getByRole("button", { name: english("account.login.sendCode"), exact: true });
  const prefix = english("account.login.developmentCode", { code: "" });
  const notice = page.getByText(new RegExp(`^${literal(prefix)}`));
  const deadline = Date.now() + WAIT_MS;
  await send.click();
  while (!(await notice.isVisible()) && Date.now() < deadline) {
    await notice.waitFor({ timeout: 5_000 }).catch(() => undefined);
    const canRetry = (await send.isVisible().catch(() => false)) && (await send.isEnabled().catch(() => false));
    if (!(await notice.isVisible()) && canRetry) await send.click();
  }
  await notice.waitFor({ timeout: 1_000 }).catch(async (error: unknown) => {
    mkdirSync(out, { recursive: true });
    await page.screenshot({ path: resolve(out, "web-failure.png") }).catch(() => undefined);
    throw new Error("The account service showed no development code.", { cause: error });
  });
  const code = (await notice.innerText()).slice(prefix.length).replaceAll("-", "").trim();
  assert.ok(code.length > 0, "The account service showed no development code.");
  await page.keyboard.type(code);
}

export async function instrumentRemotePeer(context: BrowserContext, latencyMs: number): Promise<void> {
  await context.addInitScript((halfTrip: number) => {
    const collected: NonNullable<Window["__syncPerfSink"]> = { records: [], open: 0 };
    window.__syncPerfSink = collected;
    globalThis.__openbotSyncProfile = {
      started() {
        collected.open += 1;
      },
      push(record) {
        collected.open -= 1;
        collected.records.push(record);
      },
    };
    const Native = window.RTCPeerConnection;
    const peers: RTCPeerConnection[] = [];
    window.__syncPerfPeers = peers;
    window.RTCPeerConnection = class extends Native {
      constructor(configuration?: RTCConfiguration) {
        super(configuration);
        peers.push(this);
      }
    };
    if (halfTrip <= 0) return;
    const channel = RTCDataChannel.prototype;
    const sendText: (this: RTCDataChannel, data: string) => void = channel.send;
    const sendBlob: (this: RTCDataChannel, data: Blob) => void = channel.send;
    const sendBuffer: (this: RTCDataChannel, data: ArrayBuffer) => void = channel.send;
    const sendView: (this: RTCDataChannel, data: ArrayBufferView<ArrayBuffer>) => void = channel.send;
    type Payload = string | Blob | ArrayBuffer | ArrayBufferView<ArrayBuffer>;
    const deliver = (target: RTCDataChannel, data: Payload) => {
      if (typeof data === "string") sendText.call(target, data);
      else if (data instanceof Blob) sendBlob.call(target, data);
      else if (data instanceof ArrayBuffer) sendBuffer.call(target, data);
      else sendView.call(target, data);
    };
    channel.send = function (this: RTCDataChannel, data: Payload) {
      if (this.readyState !== "open") return deliver(this, data);
      setTimeout(() => {
        if (this.readyState === "open") deliver(this, data);
      }, halfTrip);
    };
    const later =
      <E extends Event>(listener: (event: E) => void) =>
      (event: E) =>
        void setTimeout(() => listener(event), halfTrip);
    const wrapped = new WeakMap<object, (event: Event) => void>();
    const add = channel.addEventListener;
    const remove = channel.removeEventListener;
    channel.addEventListener = function (
      this: RTCDataChannel,
      type: string,
      listener: EventListenerOrEventListenerObject,
      options?: boolean | AddEventListenerOptions,
    ) {
      if (type !== "message") return add.call(this, type, listener, options);
      const delayed =
        wrapped.get(listener) ??
        later((event) => (typeof listener === "function" ? listener.call(this, event) : listener.handleEvent(event)));
      wrapped.set(listener, delayed);
      add.call(this, type, delayed, options);
    };
    channel.removeEventListener = function (
      this: RTCDataChannel,
      type: string,
      listener: EventListenerOrEventListenerObject,
      options?: boolean | EventListenerOptions,
    ) {
      remove.call(this, type, wrapped.get(listener) ?? listener, options);
    };
    const onmessage = Object.getOwnPropertyDescriptor(channel, "onmessage");
    if (onmessage?.set && onmessage.get) {
      const { get, set } = onmessage;
      Object.defineProperty(channel, "onmessage", {
        configurable: true,
        enumerable: onmessage.enumerable ?? true,
        get() {
          return get.call(this);
        },
        set(this: RTCDataChannel, handler: ((event: MessageEvent) => void) | null) {
          set.call(this, handler ? later<MessageEvent>((event) => handler.call(this, event)) : null);
        },
      });
    }
  }, latencyMs / 2);
}

export async function readSyncSink(page: Page): Promise<{ records: RemoteRequestRecord[]; open: number }> {
  const sink = await page.evaluate(() => window.__syncPerfSink ?? null);
  assert.ok(sink, "The page has no sync profile sink.");
  return sink;
}

export const delay = (ms: number) => new Promise<void>((done) => setTimeout(done, ms));

export const MARK_PREFIX = "openbot:remote-";
const QUIET_MS = 1_500;

export function pageNow(page: Page): Promise<number> {
  return page.evaluate(() => performance.timeOrigin + performance.now());
}

export async function waitMark(page: Page, name: string, after: number): Promise<void> {
  await page.waitForFunction(
    ({ mark, after }) =>
      performance.getEntriesByName(mark).some((entry) => performance.timeOrigin + entry.startTime >= after),
    { mark: `${MARK_PREFIX}${name}`, after },
    { timeout: WAIT_MS, polling: 100 },
  );
}

export async function settleNetwork(page: Page, from: number): Promise<RemoteRequestRecord[]> {
  const deadline = Date.now() + WAIT_MS;
  for (;;) {
    const sink = await readSyncSink(page);
    const mine = sink.records.filter((record) => record.startedAt >= from);
    const lastEnd = Math.max(from, ...mine.map((record) => record.endedAt));
    if (sink.open === 0 && (await pageNow(page)) - lastEnd >= QUIET_MS) return mine;
    if (Date.now() > deadline) throw new Error("The network of the page did not become quiet.");
    await delay(100);
  }
}

export async function addNetworkLatency(context: BrowserContext, latencyMs: number): Promise<void> {
  const delayed = new Set(["document", "fetch", "xhr"]);
  await context.route("**/*", async (route) => {
    if (delayed.has(route.request().resourceType())) await delay(latencyMs);
    await route.fallback();
  });
  await context.routeWebSocket(/.*/, (socket) => {
    const server = socket.connectToServer();
    socket.onMessage((message) => void delay(latencyMs / 2).then(() => server.send(message)));
    server.onMessage((message) => void delay(latencyMs / 2).then(() => socket.send(message)));
  });
}
