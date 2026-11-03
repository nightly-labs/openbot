// Measures how fast a remote client gets the user into the workspace, and which requests it sends to
// the host before and after that point. It is the baseline for lazy sync.
//
// Start this worktree's stack with `OPENBOT_DEV_SYNC_PROFILE=1 bun run dev:test-client` (never
// `--shared`). Add `OPENBOT_DEV_ICE_TRANSPORT_POLICY=relay` to make the host use TURN relay
// candidates only. Then run
// `bun run perf:remote [--runs=5] [--label=<name>] [--clients=web,desktop,desktop-start] [--api=<url>]
//  [--compare=<old report.json>] [--browser-executable=<path>] [--host-id=<id>] [--allow-mutations]
//  [--latency=<ms>]`.
// Add `OPENBOT_DEV_CLIENT_TRANSPORT=webrtc` to the stack to make the test client reach the host over
// Signal and WebRTC, as a user does, and `OPENBOT_DEV_RTT_MS=<ms>`, equal to `--latency`, to add the
// round trip to its data channel and account service reads.
//
// - web: signs in to `${api}/app` as the dev host user once, then opens `/app` in a new browser
//   context for each run. A recorder in the page collects each request to the host. A new seed gives
//   the host a new id, and the account keeps the old host; `--host-id` selects the new one.
//   `web` runs start with no saved workspace frame; `web-warm` runs start with the frame of the
//   first load, as a user who comes back does. `--latency` adds that many milliseconds to each
//   document and fetch request of the page and to each WebSocket round trip (signaling), not to
//   module files, and half of it to each data-channel message in each direction.
// - desktop: reads the test-client app that is running. The first sample is its cold start: the
//   connect spans of `logs/trace.ndjson`, the request file that main writes with
//   `OPENBOT_DEV_SYNC_PROFILE=1`, and the renderer marks. With `--allow-mutations`, each further run
//   reloads the renderer; main keeps its connection, so a reload measures the renderer gate only.
// - desktop-start: with `--allow-mutations`, each run restarts only the test client
//   (`bun run dev:restart-client`) while the host stays live. The origin is the start of the new main
//   process, from the first line of its request file. Its Signal socket does not get the latency.
//
// `frameMs` is the time to the `workspace-frame` mark: the saved frame shows, read-only, before the
// host answers. A request that ends before the `workspace-ready` mark is a gate request. The others are background
// requests. A run settles at the end of the last request before a pause of `SETTLE_GAP_MS`.
// Writes .openbot-build/remote-sync-perf/<label>/report.json, waterfall.md and, with --compare,
// comparison.md. Records hold route templates, never ids; the script stops when a route holds a UUID.
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { isDynamicRecord, isNumber, isString } from "@openbot/contracts/runtime-values";
import { translateFor } from "@openbot/i18n";
import { createOpenBotLogger } from "@openbot/logging";
import type { RemoteRequestRecord } from "@openbot/team-client/sync-profile";
import { type Browser, type BrowserContext, chromium, type Page } from "playwright-core";
import { argument, WAIT_MS } from "./channel-e2e-support";
import { type Spread, spread } from "./dev-automation/bench-stats";
import { assertMutationAllowed, connectToDevApp } from "./dev-automation/cdp-client";
import { type DevInstanceRecord, readDevInstanceRecords } from "./dev-automation/instance-registry";
import { resolveDevelopmentAppDataRoot } from "./development-state-paths";

const NAME = "remote-sync-perf";
const ROOT = resolve(import.meta.dirname, "..");
const DEV_HOST_EMAIL = "openbot-dev-host@example.com";
const MARK_PREFIX = "openbot:remote-";
const SYNC_FILE = "dev-sync-profile.ndjson";
const SETTLE_GAP_MS = 500;
const POLL_MS = 250;
const UUID = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i;
const english = translateFor("en");
const logger = createOpenBotLogger(NAME);

const runs = Number(argument("runs") ?? "5");
assert.ok(Number.isInteger(runs) && runs >= 1, "--runs takes a whole number, 1 or more.");
const label = argument("label") ?? "baseline";
assert.match(label, /^\w[\w.-]*$/, "--label takes a folder name, not a path.");
const OUT = resolve(ROOT, ".openbot-build", NAME, label);
const api = (argument("api") ?? "http://localhost:3100").replace(/\/$/, "");
const clients = new Set((argument("clients") ?? "web,desktop").split(","));
for (const client of clients)
  assert.ok(client === "web" || client === "desktop" || client === "desktop-start", `Unknown client: ${client}.`);
const comparePath = argument("compare");
const browserExecutable = argument("browser-executable");
const hostId = argument("host-id");
const allowMutations = process.argv.includes("--allow-mutations");
const latencyMs = Number(argument("latency") ?? "0");
assert.ok(Number.isInteger(latencyMs) && latencyMs >= 0, "--latency takes a whole number of milliseconds.");
const FRAME_KEY_PREFIX = "openbot:remote-frame:";

type Client = "web" | "web-warm" | "desktop-cold" | "desktop-reload" | "desktop-start";
type StorageState = Awaited<ReturnType<BrowserContext["storageState"]>>;

interface Mark {
  name: string;
  at: number;
}

interface Run {
  client: Client;
  /** Epoch time of navigation start, or of process start for a cold desktop sample. */
  origin: number;
  /** Epoch time the client began to connect: the `connect-start` mark, or the first connect span. */
  connectAt: number | null;
  marks: Mark[];
  /** Desktop main connect phases, in milliseconds after the origin. */
  connectPhases: Record<string, number>;
  requests: RemoteRequestRecord[];
  /** Selected ICE candidate types, `local/remote`. Web only. */
  candidates: string | null;
}

interface RunMetrics {
  /** The saved workspace frame shows. Null when the client had no frame. */
  frameMs: number | null;
  ttiMs: number;
  ttiFromConnectMs: number | null;
  firstConversationMs: number | null;
  settledMs: number;
  gateRequests: number;
  gateBytes: number;
  gateDepth: number;
  gateDuplicates: number;
  backgroundRequests: number;
  backgroundBytes: number;
  failedRequests: number;
  phases: Record<string, number>;
}

interface Report {
  label: string;
  createdAt: string;
  commit: string;
  runs: number;
  /** Added round trip, `--latency`: the web page's HTTP, WebSocket and data channel. */
  latencyMs: number;
  /** `OPENBOT_DEV_RTT_MS` of each desktop-start run, from its request file. */
  desktopRoundTripMs: number[];
  /** The failure codes of each client and how often each came. */
  failures: Record<string, Record<string, number>>;
  candidates: Record<string, string[]>;
  /** The request transports of each client: `webrtc`, or `http` for a test client without a WebRTC membership. */
  transports: Record<string, string[]>;
  metrics: Record<string, Spread>;
  routes: Record<string, RouteRow[]>;
}

interface RouteRow {
  route: string;
  count: number;
  gate: number;
  medianMs: number;
  responseBytes: number;
}

declare global {
  interface Window {
    __syncPerfPeers?: RTCPeerConnection[];
    /** What the page sink collected: the records, and the requests in flight. */
    __syncPerfSink?: { records: RemoteRequestRecord[]; open: number };
  }
}

// ---------------------------------------------------------------- shared

const literal = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const bytes = (record: RemoteRequestRecord) => record.requestBytes + record.responseBytes;
const routeKey = (record: RemoteRequestRecord) => `${record.method} ${record.route}`;

function markAt(run: Run, name: string): number | null {
  return run.marks.find((mark) => mark.name === name)?.at ?? null;
}

/** The end of the last request before the first pause of `SETTLE_GAP_MS` after `from`. */
function settledAt(requests: readonly RemoteRequestRecord[], from: number): number {
  let busyUntil = from;
  for (const record of [...requests].sort((left, right) => left.startedAt - right.startedAt)) {
    if (record.startedAt > busyUntil + SETTLE_GAP_MS) break;
    busyUntil = Math.max(busyUntil, record.endedAt);
  }
  return busyUntil;
}

/** The longest chain of requests where each one starts after the one before it ended. */
function criticalDepth(requests: readonly RemoteRequestRecord[]): number {
  const sorted = [...requests].sort((left, right) => left.endedAt - right.endedAt);
  const depth: number[] = [];
  let longest = 0;
  for (const [index, record] of sorted.entries()) {
    let before = 0;
    for (let other = 0; other < index; other += 1) {
      const previous = sorted[other];
      if (previous && previous.endedAt <= record.startedAt) before = Math.max(before, depth[other] ?? 0);
    }
    depth.push(before + 1);
    longest = Math.max(longest, before + 1);
  }
  return longest;
}

// Counts each repeat of a method and route template. A template has no ids, so one read for each of
// several ids (such as `GET /v1/agents/:id/queue`) counts as repeats too; read the route table.
function duplicates(requests: readonly RemoteRequestRecord[]): number {
  const seen = new Map<string, number>();
  for (const record of requests) seen.set(routeKey(record), (seen.get(routeKey(record)) ?? 0) + 1);
  return [...seen.values()].reduce((sum, count) => sum + count - 1, 0);
}

/** The requests of one run, split at the gate. Requests after the settle point are left out. */
function split(run: Run): { gate: RemoteRequestRecord[]; background: RemoteRequestRecord[]; settled: number } {
  const ready = markAt(run, "workspace-ready");
  assert.ok(ready !== null, `${run.client}: no workspace-ready mark.`);
  const settled = settledAt(run.requests, Math.max(ready, markAt(run, "conversation-ready") ?? ready));
  const inRun = run.requests.filter((record) => record.startedAt <= settled);
  return {
    gate: inRun.filter((record) => record.endedAt <= ready),
    background: inRun.filter((record) => record.endedAt > ready),
    settled,
  };
}

function measure(run: Run): RunMetrics {
  const ready = markAt(run, "workspace-ready") ?? run.origin;
  const conversation = markAt(run, "conversation-ready");
  const frame = markAt(run, "workspace-frame");
  const { gate, background, settled } = split(run);
  const phases: Record<string, number> = { ...run.connectPhases };
  for (const mark of run.marks) phases[mark.name] = Math.round(mark.at - run.origin);
  return {
    frameMs: frame === null ? null : Math.round(frame - run.origin),
    ttiMs: Math.round(ready - run.origin),
    ttiFromConnectMs: run.connectAt === null ? null : Math.round(ready - run.connectAt),
    firstConversationMs: conversation === null ? null : Math.round(conversation - run.origin),
    settledMs: Math.round(settled - run.origin),
    gateRequests: gate.length,
    gateBytes: gate.reduce((sum, record) => sum + bytes(record), 0),
    gateDepth: criticalDepth(gate),
    gateDuplicates: duplicates(gate),
    backgroundRequests: background.length,
    backgroundBytes: background.reduce((sum, record) => sum + bytes(record), 0),
    failedRequests: [...gate, ...background].filter((record) => record.outcome === "error").length,
    phases,
  };
}

function routeTable(client: Client, sample: readonly Run[]): RouteRow[] {
  const rows = new Map<string, { durations: number[]; gate: number; bytes: number[] }>();
  for (const run of sample) {
    const { gate, background } = split(run);
    const gated = new Set(gate);
    for (const record of [...gate, ...background]) {
      const row = rows.get(routeKey(record)) ?? { durations: [], gate: 0, bytes: [] };
      row.durations.push(record.endedAt - record.startedAt);
      row.bytes.push(record.responseBytes);
      if (gated.has(record)) row.gate += 1;
      rows.set(routeKey(record), row);
    }
  }
  assert.ok(sample.length > 0, `${client}: no runs.`);
  return [...rows.entries()]
    .map(([route, row]) => ({
      route,
      count: Math.round((row.durations.length / sample.length) * 10) / 10,
      gate: Math.round((row.gate / sample.length) * 10) / 10,
      medianMs: spread(row.durations)?.median ?? 0,
      responseBytes: spread(row.bytes)?.median ?? 0,
    }))
    .sort((left, right) => right.gate - left.gate || right.count - left.count);
}

/** A text timeline of one run, each request marked as gate or background. */
function waterfall(run: Run): string {
  const { gate, background } = split(run);
  const gated = new Set(gate);
  const transports = [...new Set(run.requests.map((record) => record.transport))].join(", ") || "none";
  const lines = [
    `### ${run.client} (${transports}${run.candidates ? `, ICE ${run.candidates}` : ""})`,
    "",
    "| Start ms | End ms | Request | Bytes | Gate |",
    "| ---: | ---: | --- | ---: | --- |",
  ];
  const events = [
    ...run.marks.map((mark) => ({
      at: mark.at,
      line: `| ${Math.round(mark.at - run.origin)} | | **${mark.name}** | | |`,
    })),
    ...Object.entries(run.connectPhases).map(([name, at]) => ({
      at: run.origin + at,
      line: `| ${at} | | _${name}_ | | |`,
    })),
    ...[...gate, ...background].map((record) => ({
      at: record.startedAt,
      line: `| ${Math.round(record.startedAt - run.origin)} | ${Math.round(record.endedAt - run.origin)} | ${routeKey(record)}${outcomeNote(record)} | ${bytes(record)} | ${gated.has(record) ? "blocks gate" : "after gate"} |`,
    })),
  ].sort((left, right) => left.at - right.at);
  return [...lines, ...events.map((event) => event.line), ""].join("\n");
}

function outcomeNote(record: RemoteRequestRecord): string {
  if (record.outcome === "aborted") return " (aborted)";
  return record.outcome === "error" ? ` (error ${record.failure ?? "?"})` : "";
}

function assertNoIds(run: Run): void {
  for (const record of run.requests)
    assert.ok(!UUID.test(record.route), `${run.client}: the route ${record.route} holds an id.`);
}

function isRequestRecord(value: unknown): value is RemoteRequestRecord {
  return (
    isDynamicRecord(value) &&
    isString(value.route) &&
    isString(value.method) &&
    (value.transport === "webrtc" || value.transport === "http") &&
    isNumber(value.startedAt) &&
    isNumber(value.endedAt) &&
    isNumber(value.requestBytes) &&
    isNumber(value.responseBytes)
  );
}

// ---------------------------------------------------------------- web

/** Signs in to the web client with the code that the development account service shows. */
async function signIn(page: Page): Promise<void> {
  await page.goto(`${api}/app`);
  await page.getByRole("textbox", { name: english("account.login.email"), exact: true }).fill(DEV_HOST_EMAIL);
  const send = page.getByRole("button", { name: english("account.login.sendCode"), exact: true });
  const prefix = english("account.login.developmentCode", { code: "" });
  const notice = page.getByText(new RegExp(`^${literal(prefix)}`));
  // A test client that signs in as the host user (`OPENBOT_DEV_CLIENT_TRANSPORT=webrtc`) can start
  // the account service's wait between codes. Send again until the code shows.
  const deadline = Date.now() + WAIT_MS;
  await send.click();
  while (!(await notice.isVisible()) && Date.now() < deadline) {
    await notice.waitFor({ timeout: 5_000 }).catch(() => undefined);
    if (!(await notice.isVisible()) && (await send.isEnabled())) await send.click();
  }
  await notice.waitFor({ timeout: 1_000 }).catch(async (error: unknown) => {
    mkdirSync(OUT, { recursive: true });
    await page.screenshot({ path: resolve(OUT, "web-failure.png") }).catch(() => undefined);
    throw new Error("The account service showed no development code.", { cause: error });
  });
  const code = (await notice.innerText()).slice(prefix.length).replaceAll("-", "").trim();
  assert.ok(code.length > 0, "The account service showed no development code.");
  // The code field takes the focus when it shows.
  await page.keyboard.type(code);
}

const SELECTED_SERVER_PREFIX = "openbot.web.selected-server:";

/** Writes the host choice that the web client keeps for the account, then opens `/app` again. */
async function selectHost(page: Page, id: string): Promise<void> {
  await page.waitForFunction(
    (prefix) => Object.keys(localStorage).some((key) => key.startsWith(prefix)),
    SELECTED_SERVER_PREFIX,
    { timeout: WAIT_MS, polling: POLL_MS },
  );
  await page.evaluate(
    ({ prefix, id }) => {
      for (const key of Object.keys(localStorage)) if (key.startsWith(prefix)) localStorage.setItem(key, id);
    },
    { prefix: SELECTED_SERVER_PREFIX, id },
  );
  await page.reload();
}

async function instrument(context: BrowserContext): Promise<void> {
  await context.addInitScript((halfTrip: number) => {
    const collected: NonNullable<Window["__syncPerfSink"]> = { records: [], open: 0 };
    window.__syncPerfSink = collected;
    // The recorder of `@openbot/team-client/sync-profile` finds this sink by its global name.
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
    // Half of the round trip each way. Equal delays keep the order of the messages. A send on a
    // channel that is not open goes at once, so the client still gets the error it expects.
    const channel = RTCDataChannel.prototype;
    // One native signature for each kind of payload: `send` is overloaded.
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

/** The records and the count of requests in flight that the page sink holds. */
async function readSink(page: Page): Promise<{ records: RemoteRequestRecord[]; open: number }> {
  const sink = await page.evaluate(() => window.__syncPerfSink ?? null);
  assert.ok(sink, "The page has no sync profile sink.");
  return sink;
}

function readMarks(page: Page): Promise<Mark[]> {
  return page.evaluate(
    (prefix) =>
      performance
        .getEntriesByType("mark")
        .filter((entry) => entry.name.startsWith(prefix))
        .map((entry) => ({ name: entry.name.slice(prefix.length), at: performance.timeOrigin + entry.startTime })),
    MARK_PREFIX,
  );
}

/** Reads `read` until `ready` accepts two readings in a row. The app pushes no event to a script. */
async function settle<T>(page: Page, what: string, read: () => Promise<T>, ready: (value: T) => boolean): Promise<T> {
  const deadline = Date.now() + WAIT_MS;
  let streak = 0;
  for (;;) {
    const value = await read();
    streak = ready(value) ? streak + 1 : 0;
    if (streak >= 2) return value;
    if (Date.now() > deadline) throw new Error(`Timed out: ${what}. Last value: ${JSON.stringify(value)}`);
    await page.waitForTimeout(POLL_MS);
  }
}

function selectedCandidates(page: Page): Promise<string | null> {
  return page.evaluate(async () => {
    for (const pc of window.__syncPerfPeers ?? []) {
      if (pc.connectionState !== "connected") continue;
      const stats = await pc.getStats();
      let pair: string | null = null;
      stats.forEach((entry) => {
        if (entry.type === "transport" && entry.selectedCandidatePairId) pair = entry.selectedCandidatePairId;
      });
      const selected = pair ? stats.get(pair) : undefined;
      if (!selected) continue;
      const local = stats.get(selected.localCandidateId)?.candidateType ?? "?";
      const remote = stats.get(selected.remoteCandidateId)?.candidateType ?? "?";
      return `${local}/${remote}`;
    }
    return null;
  });
}

/**
 * Writes `<name>.png` once the saved frame shows, the artifact of a warm start. It tells whether the
 * host had answered before the screenshot: then the image shows loaded data, not the frame.
 */
async function captureFrame(page: Page, name: string): Promise<void> {
  const shown = await page
    .waitForFunction((mark) => performance.getEntriesByName(mark).length > 0, `${MARK_PREFIX}workspace-frame`, {
      timeout: WAIT_MS,
      polling: "raf",
    })
    .then(() => true)
    .catch(() => false);
  if (!shown) {
    logger.info(`${name}: no workspace-frame mark; no frame screenshot.`);
    return;
  }
  mkdirSync(OUT, { recursive: true });
  await page.screenshot({ path: resolve(OUT, `${name}.png`) });
  const ready = await page.evaluate(
    (mark) => performance.getEntriesByName(mark).length > 0,
    `${MARK_PREFIX}workspace-ready`,
  );
  logger.info(
    `${name}.png: ${ready ? "the host answered before the screenshot" : "the frame, before the host answered"}.`,
  );
}

const delay = (ms: number) => new Promise<void>((done) => setTimeout(done, ms));

/**
 * Adds `--latency` to each page request and each WebSocket message. Module and style files keep their
 * time: the dev server sends hundreds of them, where a release build sends a few.
 */
async function addLatency(context: BrowserContext): Promise<void> {
  const delayed = new Set(["document", "fetch", "xhr"]);
  await context.route("**/*", async (route) => {
    if (delayed.has(route.request().resourceType())) await delay(latencyMs);
    await route.fallback();
  });
  // Half of the round trip each way. Equal delays keep the order of the messages.
  await context.routeWebSocket(/.*/, (socket) => {
    const server = socket.connectToServer();
    socket.onMessage((message) => void delay(latencyMs / 2).then(() => server.send(message)));
    server.onMessage((message) => void delay(latencyMs / 2).then(() => socket.send(message)));
  });
}

/** The state with no saved workspace frame: a first visit, or a cleared browser. */
function withoutFrames(state: StorageState): StorageState {
  return {
    ...state,
    origins: state.origins.map((origin) => ({
      ...origin,
      localStorage: origin.localStorage.filter((item) => !item.name.startsWith(FRAME_KEY_PREFIX)),
    })),
  };
}

function hasFrame(state: StorageState): boolean {
  return state.origins.some((origin) => origin.localStorage.some((item) => item.name.startsWith(FRAME_KEY_PREFIX)));
}

async function webRun(browser: Browser, client: "web" | "web-warm", storageState: StorageState, capture = false) {
  const context = await browser.newContext({ storageState, viewport: { width: 1280, height: 900 } });
  try {
    await instrument(context);
    const page = await context.newPage();
    if (latencyMs > 0) await addLatency(context);
    await page.goto(`${api}/app`);
    if (capture) await captureFrame(page, "web-warm-frame");
    const state = await settle(
      page,
      "the web client settles",
      async () => ({ marks: await readMarks(page), sink: await readSink(page) }),
      ({ marks, sink }) =>
        sink.open === 0 &&
        ["workspace-ready", "panels-ready"].every((name) => marks.some((mark) => mark.name === name)),
    );
    const run: Run = {
      client,
      origin: await page.evaluate(() => performance.timeOrigin),
      connectAt: state.marks.find((mark) => mark.name === "connect-start")?.at ?? null,
      marks: state.marks,
      connectPhases: {},
      requests: state.sink.records,
      candidates: await selectedCandidates(page),
    };
    return run;
  } finally {
    await context.close();
  }
}

async function webRuns(): Promise<Run[]> {
  const browser = await chromium.launch(
    browserExecutable ? { executablePath: browserExecutable } : { channel: "chrome" },
  );
  try {
    const first = await browser.newContext({ viewport: { width: 1280, height: 900 } });
    const page = await first.newPage();
    await signIn(page);
    if (hostId) await selectHost(page, hostId);
    // The frame is saved when the panels answer, so the warm state waits for `panels-ready`.
    await page
      .waitForFunction(
        (names) => names.every((name) => performance.getEntriesByName(name).length > 0),
        [`${MARK_PREFIX}workspace-ready`, `${MARK_PREFIX}panels-ready`],
        { timeout: WAIT_MS, polling: POLL_MS },
      )
      .catch(async (error: unknown) => {
        mkdirSync(OUT, { recursive: true });
        await page.screenshot({ path: resolve(OUT, "web-failure.png") }).catch(() => undefined);
        const seen = (await readMarks(page)).map((mark) => mark.name).join(", ") || "none";
        throw new Error(`The web client did not reach panels-ready. Marks: ${seen}.`, { cause: error });
      });
    // The session stays in memory: the state holds the sign-in cookie, so it is not written to disk.
    const warm = await first.storageState();
    await first.close();
    assert.ok(hasFrame(warm), "The web client saved no workspace frame.");
    const cold = withoutFrames(warm);
    const result: Run[] = [];
    // Cold and warm runs take turns, so a slow period of the host falls on both.
    for (let index = 0; index < runs; index += 1) {
      result.push(await webRun(browser, "web", cold));
      result.push(await webRun(browser, "web-warm", warm, index === 0));
      logger.info(`web run ${index + 1}/${runs}`);
    }
    return result;
  } finally {
    await browser.close();
  }
}

// ---------------------------------------------------------------- desktop

interface TraceLine {
  at: number;
  kind: string;
  name: string;
  durationMs: number;
}

function readTrace(path: string): TraceLine[] {
  if (!existsSync(path)) return [];
  const lines: TraceLine[] = [];
  for (const text of readFileSync(path, "utf8").split("\n")) {
    if (!text) continue;
    const value = JSON.parse(text);
    if (isDynamicRecord(value) && isString(value.at) && isString(value.name) && isNumber(value.durationMs))
      lines.push({
        at: Date.parse(value.at),
        kind: String(value.kind),
        name: value.name,
        durationMs: value.durationMs,
      });
  }
  return lines;
}

interface SyncFile {
  records: RemoteRequestRecord[];
  open: number;
  /** The first line: when the main process started, and its `OPENBOT_DEV_RTT_MS`. */
  process: { startedAt: number; roundTripMs: number } | null;
}

function readSyncFile(path: string): SyncFile {
  const records: RemoteRequestRecord[] = [];
  let started = 0;
  let processLine: SyncFile["process"] = null;
  // The new process empties the file and writes it again, so a read can find it empty for a moment.
  const text = existsSync(path) ? readFileSync(path, "utf8") : "";
  for (const line of text.split("\n")) {
    if (!line) continue;
    const value = JSON.parse(line);
    if (!isDynamicRecord(value)) continue;
    if (value.event === "process" && isNumber(value.startedAt) && isNumber(value.roundTripMs))
      processLine = { startedAt: value.startedAt, roundTripMs: value.roundTripMs };
    else if (value.event === "start") started += 1;
    else if (value.event === "end" && isRequestRecord(value)) records.push(value);
  }
  return { records, open: started - records.length, process: processLine };
}

/** The process start from `ps`, to one second, for a request file without its first line. */
function processStart(pid: number): number {
  const text = execFileSync("ps", ["-o", "lstart=", "-p", String(pid)], { encoding: "utf8" }).trim();
  const at = Date.parse(text);
  assert.ok(Number.isFinite(at), `ps gave no start time for ${pid}.`);
  return at;
}

function testClientInstances(): DevInstanceRecord[] {
  return readDevInstanceRecords().filter(
    (record) => record.service === "test-client" && resolve(record.projectRoot) === ROOT,
  );
}

function testClientInstance(): DevInstanceRecord {
  const instances = testClientInstances();
  assert.equal(
    instances.length,
    1,
    "Start `OPENBOT_DEV_SYNC_PROFILE=1 bun run dev:test-client` in this worktree first.",
  );
  const [instance] = instances;
  assert.ok(instance);
  return instance;
}

/** Calls `read` until it gives a value. A restart has no event that a script can wait for. */
async function poll<T>(what: string, read: () => T | null | Promise<T | null>): Promise<T> {
  const deadline = Date.now() + WAIT_MS;
  for (;;) {
    const value = await read();
    if (value !== null) return value;
    if (Date.now() > deadline) throw new Error(`Timed out: ${what}.`);
    await delay(POLL_MS);
  }
}

/** The connect spans of main after `origin`, each phase once, in milliseconds after `origin`. */
function connectPhasesAfter(
  userData: string,
  origin: number,
): { phases: Record<string, number>; begin: number | null } {
  const spans = readTrace(join(userData, "logs", "trace.ndjson")).filter(
    (span) => span.kind === "connect" && span.at >= origin,
  );
  const phases: Record<string, number> = {};
  for (const span of spans) {
    const phase = span.name.replace(/^remote-connect:/, "main:");
    if (!(phase in phases)) phases[phase] = Math.round(span.at - origin);
  }
  return { phases, begin: spans.find((span) => span.name === "remote-connect:start")?.at ?? null };
}

const desktopRoundTrips: number[] = [];

/** Restarts only the test client, then times its start until the workspace is ready and quiet. */
async function desktopStartRun(capture: boolean): Promise<Run> {
  const previous = testClientInstance();
  const requestedAt = Date.now();
  execFileSync("bun", ["scripts/dev-stack.ts", "restart-client"], { cwd: ROOT, stdio: "inherit" });
  const instance = await poll("the test client starts again", () => {
    const [next, ...more] = testClientInstances();
    return next && more.length === 0 && next.pid !== previous.pid ? next : null;
  });
  const userData = join(resolveDevelopmentAppDataRoot(), instance.profile);
  const syncPath = join(userData, SYNC_FILE);
  const started = await poll("the new main process writes its request file", () => {
    const line = readSyncFile(syncPath).process;
    return line && line.startedAt >= requestedAt ? line : null;
  });
  desktopRoundTrips.push(started.roundTripMs);
  const session = await poll("the new window takes a CDP connection", () =>
    connectToDevApp(instance.remoteDebuggingPort, logger, {
      expectedRendererPort: instance.rendererPort,
      ownerPid: instance.pid,
    }).catch(() => null),
  );
  try {
    const page = session.page;
    if (capture) await captureFrame(page, "desktop-start-frame");
    const state = await settle(
      page,
      "the restarted desktop client settles",
      async () => ({ marks: await readMarks(page), file: readSyncFile(syncPath) }),
      ({ marks, file }) => file.open === 0 && marks.some((mark) => mark.name === "workspace-ready"),
    );
    const origin = started.startedAt;
    const { phases, begin } = connectPhasesAfter(userData, origin);
    phases["renderer:navigation"] = Math.round((await page.evaluate(() => performance.timeOrigin)) - origin);
    return {
      client: "desktop-start",
      origin,
      connectAt: begin,
      marks: state.marks,
      connectPhases: phases,
      requests: state.file.records,
      candidates: null,
    };
  } finally {
    await session.close();
  }
}

async function desktopStartRuns(): Promise<Run[]> {
  assertMutationAllowed({
    command: "perf:remote desktop-start restarts",
    allowMutations,
    instanceNamed: true,
    target: testClientInstance().instanceId,
  });
  const result: Run[] = [];
  for (let index = 0; index < runs; index += 1) {
    result.push(await desktopStartRun(index === 0));
    logger.info(`desktop start ${index + 1}/${runs}`);
  }
  return result;
}

async function desktopRuns(): Promise<Run[]> {
  const instance = testClientInstance();
  const userData = join(resolveDevelopmentAppDataRoot(), instance.profile);
  const syncPath = join(userData, SYNC_FILE);
  assert.ok(existsSync(syncPath), `${syncPath} is missing. Start the stack with OPENBOT_DEV_SYNC_PROFILE=1.`);
  const session = await connectToDevApp(instance.remoteDebuggingPort, logger, {
    expectedRendererPort: instance.rendererPort,
    ownerPid: instance.pid,
  });
  const page = session.page;
  const readState = async () => ({ marks: await readMarks(page), file: readSyncFile(syncPath) });
  const settled = (state: Awaited<ReturnType<typeof readState>>) =>
    state.file.open === 0 && state.marks.some((mark) => mark.name === "workspace-ready");
  try {
    const result: Run[] = [];
    // The cold sample: the start of the running process.
    const navigation = await page.evaluate(() => {
      const entry = performance.getEntriesByType("navigation")[0];
      return entry && "type" in entry ? String(entry.type) : "";
    });
    if (navigation === "navigate") {
      const cold = await settle(page, "the desktop client settles", readState, settled);
      const origin = cold.file.process?.startedAt ?? processStart(instance.pid);
      const { phases: connectPhases, begin } = connectPhasesAfter(userData, origin);
      result.push({
        client: "desktop-cold",
        origin,
        connectAt: begin,
        marks: cold.marks,
        connectPhases,
        requests: cold.file.records,
        candidates: null,
      });
    } else {
      logger.info(`The renderer was loaded by "${navigation}", not a new start; the cold sample is skipped.`);
    }
    if (runs > 1 || result.length === 0) {
      assertMutationAllowed({
        command: "perf:remote desktop reloads",
        allowMutations,
        instanceNamed: true,
        target: instance.instanceId,
      });
      for (let index = 0; index < runs; index += 1) {
        const before = readSyncFile(syncPath).records.length;
        // `commit`, not `load`: the frame can show and go before the load event.
        await page.reload({ waitUntil: "commit" });
        if (index === 0) await captureFrame(page, "desktop-frame");
        const state = await settle(page, "the desktop renderer settles", readState, settled);
        result.push({
          client: "desktop-reload",
          origin: await page.evaluate(() => performance.timeOrigin),
          connectAt: null,
          marks: state.marks,
          connectPhases: {},
          requests: state.file.records.slice(before),
          candidates: null,
        });
        logger.info(`desktop reload ${index + 1}/${runs}`);
      }
    }
    return result;
  } finally {
    await session.close();
  }
}

// ---------------------------------------------------------------- report

function summarize(sample: readonly Run[]): Record<string, Spread> {
  const values = new Map<string, number[]>();
  const add = (key: string, value: number | null) => {
    if (value !== null) values.set(key, [...(values.get(key) ?? []), value]);
  };
  for (const run of sample) {
    const metrics = measure(run);
    for (const [key, value] of Object.entries(metrics)) {
      if (key === "phases") continue;
      add(`${run.client}.${key}`, typeof value === "number" ? value : null);
    }
    for (const [phase, at] of Object.entries(metrics.phases)) add(`${run.client}.phase.${phase}`, at);
  }
  const result: Record<string, Spread> = {};
  for (const [key, list] of values) {
    const summary = spread(list);
    if (summary) result[key] = summary;
  }
  return result;
}

/** The run whose TTI is the median of its client. */
function medianRun(sample: readonly Run[]): Run | undefined {
  const sorted = [...sample].sort((left, right) => measure(left).ttiMs - measure(right).ttiMs);
  return sorted[Math.floor((sorted.length - 1) / 2)];
}

function parseReport(path: string): Report {
  const parsed = JSON.parse(readFileSync(path, "utf8"));
  assert.ok(isDynamicRecord(parsed) && isDynamicRecord(parsed.metrics), `${path} is not a perf:remote report.`);
  const metrics: Record<string, Spread> = {};
  for (const [key, value] of Object.entries(parsed.metrics)) {
    if (isDynamicRecord(value) && isNumber(value.median) && isNumber(value.min) && isNumber(value.max))
      metrics[key] = { median: value.median, min: value.min, max: value.max };
  }
  return {
    label: String(parsed.label ?? path),
    createdAt: String(parsed.createdAt ?? ""),
    commit: String(parsed.commit ?? ""),
    runs: isNumber(parsed.runs) ? parsed.runs : 0,
    latencyMs: isNumber(parsed.latencyMs) ? parsed.latencyMs : 0,
    desktopRoundTripMs: [],
    failures: {},
    candidates: {},
    transports: {},
    metrics,
    routes: {},
  };
}

function comparison(before: Report, after: Report): string {
  const lines = [
    `Before: ${before.label} (${before.commit}). After: ${after.label} (${after.commit}).`,
    "",
    "| Metric | Before | After | Change |",
    "| --- | ---: | ---: | ---: |",
  ];
  for (const key of Object.keys({ ...before.metrics, ...after.metrics }).sort()) {
    const old = before.metrics[key]?.median;
    const now = after.metrics[key]?.median;
    const change =
      old === undefined || now === undefined
        ? "n/a"
        : old === 0
          ? now === 0
            ? "0%"
            : "new"
          : `${now >= old ? "+" : ""}${(((now - old) / old) * 100).toFixed(1)}%`;
    lines.push(`| ${key} | ${old ?? "–"} | ${now ?? "–"} | ${change} |`);
  }
  return lines.join("\n");
}

/** The phases of a client in median order, each with the time since the step before it. */
function stepTable(client: Client, sample: readonly Run[]): string {
  const values = new Map<string, number[]>();
  for (const run of sample)
    for (const [phase, at] of Object.entries(measure(run).phases))
      values.set(phase, [...(values.get(phase) ?? []), at]);
  const rows = [...values]
    .map(([phase, list]) => ({ phase, at: spread(list)?.median ?? 0, seen: list.length }))
    .sort((left, right) => left.at - right.at);
  const lines = [`### ${client}`, "", "| Step | Median ms | Since previous | Runs |", "| --- | ---: | ---: | ---: |"];
  let previous = 0;
  for (const row of rows) {
    lines.push(`| ${row.phase} | ${row.at} | ${row.at - previous} | ${row.seen}/${sample.length} |`);
    previous = row.at;
  }
  return [...lines, ""].join("\n");
}

function failureCounts(sample: readonly Run[]): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const run of sample)
    for (const record of run.requests)
      if (record.outcome !== "ok") {
        const key = `${routeKey(record)} ${record.outcome === "error" ? (record.failure ?? "?") : "aborted"}`;
        counts[key] = (counts[key] ?? 0) + 1;
      }
  return counts;
}

const all: Run[] = [];
if (clients.has("web")) all.push(...(await webRuns()));
if (clients.has("desktop")) all.push(...(await desktopRuns()));
if (clients.has("desktop-start")) all.push(...(await desktopStartRuns()));
for (const run of all) assertNoIds(run);
for (const roundTrip of desktopRoundTrips)
  if (roundTrip !== latencyMs)
    logger.warn(`The test client runs with OPENBOT_DEV_RTT_MS=${roundTrip}, not --latency=${latencyMs}.`);

const byClient = new Map<Client, Run[]>();
for (const run of all) byClient.set(run.client, [...(byClient.get(run.client) ?? []), run]);
const report: Report = {
  label,
  createdAt: new Date().toISOString(),
  commit: execFileSync("git", ["rev-parse", "--short", "HEAD"], { cwd: ROOT, encoding: "utf8" }).trim(),
  runs,
  latencyMs,
  desktopRoundTripMs: desktopRoundTrips,
  failures: Object.fromEntries([...byClient].map(([client, sample]) => [client, failureCounts(sample)])),
  candidates: Object.fromEntries(
    [...byClient].map(([client, sample]) => [client, sample.map((run) => run.candidates ?? "n/a")]),
  ),
  transports: Object.fromEntries(
    [...byClient].map(([client, sample]) => [
      client,
      [...new Set(sample.flatMap((run) => run.requests.map((record) => record.transport)))],
    ]),
  ),
  metrics: summarize(all),
  routes: Object.fromEntries([...byClient].map(([client, sample]) => [client, routeTable(client, sample)])),
};
mkdirSync(OUT, { recursive: true });
writeFileSync(resolve(OUT, "report.json"), `${JSON.stringify(report, null, 2)}\n`);
const timelines = [...byClient.values()].flatMap((sample) => {
  const run = medianRun(sample);
  return run ? [waterfall(run)] : [];
});
writeFileSync(resolve(OUT, "waterfall.md"), `# ${label} — median run of each client\n\n${timelines.join("\n")}`);
const steps = [...byClient].map(([client, sample]) => stepTable(client, sample));
writeFileSync(resolve(OUT, "steps.md"), `# ${label} — median time of each step\n\n${steps.join("\n")}`);
const lines = Object.entries(report.metrics)
  .filter(([key]) => !key.includes(".phase."))
  .map(([key, value]) => `${key}: ${value.median} (${value.min}–${value.max})`);
logger.info(`${resolve(OUT, "report.json")}\n${lines.join("\n")}`);
if (comparePath) {
  assert.ok(statSync(comparePath).isFile(), `--compare: ${comparePath} is not a file.`);
  const table = comparison(parseReport(comparePath), report);
  writeFileSync(resolve(OUT, "comparison.md"), `${table}\n`);
  logger.info(`\n${table}`);
}
