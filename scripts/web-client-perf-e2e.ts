import assert from "node:assert/strict";
import { type ChildProcess, execFileSync, spawn } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { createServer, type Server } from "node:http";
import { resolve } from "node:path";
import { gzipSync } from "node:zlib";
import { isDynamicRecord, isNumber } from "@openbot/contracts/runtime-values";
import { createOpenBotLogger } from "@openbot/logging";
import { type Browser, type BrowserContext, chromium, type Page } from "playwright-core";
import { type Spread, spread } from "./dev-automation/bench-stats";
import { startRenderRecording } from "./dev-automation/render-metrics";

const logger = createOpenBotLogger("web-client-perf-e2e");
const ROOT = resolve(import.meta.dirname, "..");
const API_DIR = resolve(ROOT, "apps/auth-api");
const CLIENT_DIR = resolve(API_DIR, "dist/client");
const MANIFEST = resolve(CLIENT_DIR, ".vite/manifest.json");

function option(name: string): string | undefined {
  return process.argv.find((arg) => arg.startsWith(`--${name}=`))?.slice(name.length + 3);
}

const runs = Number(option("runs") ?? "5");
assert.ok(Number.isInteger(runs) && runs >= 1, "--runs takes a whole number, 1 or more.");
const outName = option("out") ?? "web-client-perf";
assert.match(outName, /^\w[\w.-]*$/, "--out takes a folder name, not a path.");
const OUT = resolve(ROOT, ".openbot-build", outName);
const phases = new Set((option("phases") ?? "bundle,load,runtime").split(","));
const throttle = option("throttle") ?? "mobile";
assert.ok(throttle === "mobile" || throttle === "none", "--throttle takes mobile or none.");
const storybook = option("storybook")?.replace(/\/$/, "");
const comparePath = option("compare");
const browserExecutable = option("browser-executable");

type Samples = Record<string, number[]>;
interface Report {
  label: string;
  createdAt: string;
  commit: string;
  runs: number;
  throttle: string;
  metrics: Record<string, Spread>;
}

function record(samples: Samples, key: string, value: number): void {
  const values = samples[key] ?? [];
  values.push(Math.round(value * 10) / 10);
  samples[key] = values;
}

interface ManifestChunk {
  file: string;
  imports?: string[];
  css?: string[];
  isEntry?: boolean;
}

const WEB_APP_KEY = "../../src/renderer/src/features/web-client/WebApp.tsx";
const WEB_WORKSPACE_KEY = "../../src/renderer/src/features/web-client/WebWorkspace.tsx";
const APP_ROUTE_KEY = "src/routes/app.lazy.tsx";

function readManifest(): Record<string, ManifestChunk> {
  assert.ok(existsSync(MANIFEST), `No Vite manifest at ${MANIFEST}. Run \`bun run api:build\` first.`);
  const parsed = JSON.parse(readFileSync(MANIFEST, "utf8"));
  assert.ok(isDynamicRecord(parsed), "The Vite manifest is not an object.");
  const manifest: Record<string, ManifestChunk> = {};
  for (const [key, value] of Object.entries(parsed)) {
    if (!isDynamicRecord(value) || typeof value.file !== "string") continue;
    const strings = (list: unknown) =>
      Array.isArray(list) ? list.filter((item): item is string => typeof item === "string") : [];
    manifest[key] = { file: value.file, imports: strings(value.imports), css: strings(value.css) };
    if (value.isEntry === true) manifest[key].isEntry = true;
  }
  return manifest;
}

function closure(manifest: Record<string, ManifestChunk>, keys: readonly string[]): Set<string> {
  const files = new Set<string>();
  const seen = new Set<string>();
  const visit = (key: string) => {
    if (seen.has(key)) return;
    seen.add(key);
    const chunk = manifest[key];
    if (!chunk) return;
    files.add(chunk.file);
    for (const css of chunk.css ?? []) files.add(css);
    for (const imported of chunk.imports ?? []) visit(imported);
  };
  for (const key of keys) visit(key);
  return files;
}

function measureBundle(samples: Samples): void {
  const manifest = readManifest();
  const entry = Object.keys(manifest).find((key) => manifest[key]?.isEntry);
  assert.ok(entry, "The Vite manifest has no entry chunk.");
  assert.ok(manifest[APP_ROUTE_KEY] && manifest[WEB_APP_KEY], "The manifest has no /app route or WebApp chunk.");
  const sizes = (files: Set<string>) => {
    const totals = { js: 0, jsGzip: 0, css: 0, cssGzip: 0, files: files.size };
    for (const file of files) {
      const content = readFileSync(resolve(CLIENT_DIR, file));
      const kind = file.endsWith(".css") ? "css" : "js";
      totals[kind] += content.byteLength;
      totals[`${kind}Gzip`] += gzipSync(content, { level: 9 }).byteLength;
    }
    return totals;
  };
  const signedOut = closure(manifest, [entry, APP_ROUTE_KEY, WEB_APP_KEY]);
  const workspace = closure(manifest, [entry, APP_ROUTE_KEY, WEB_APP_KEY, WEB_WORKSPACE_KEY]);
  for (const [name, files] of [
    ["signedOut", signedOut],
    ["workspace", workspace],
  ] as const) {
    for (const [metric, value] of Object.entries(sizes(files))) {
      record(
        samples,
        `bundle.${name}.${metric}${metric === "files" ? "" : "KB"}`,
        metric === "files" ? value : value / 1024,
      );
    }
  }
}

async function listen(server: Server): Promise<number> {
  await new Promise<void>((resolveListen) => server.listen(0, "127.0.0.1", resolveListen));
  const address = server.address();
  assert.ok(address !== null && typeof address === "object", "The server has no TCP address.");
  return address.port;
}

async function freePort(): Promise<number> {
  const server = createServer();
  const port = await listen(server);
  await new Promise<void>((resolveClose) => server.close(() => resolveClose()));
  return port;
}

async function waitForOk(url: string, child: ChildProcess): Promise<void> {
  const deadline = Date.now() + 60_000;
  for (;;) {
    assert.ok(child.exitCode === null, "vite preview stopped during startup.");
    const ok = await fetch(url, { signal: AbortSignal.timeout(2_000) })
      .then((response) => response.ok)
      .catch(() => false);
    if (ok) return;
    assert.ok(Date.now() < deadline, `${url} did not answer in 60 s.`);
    await new Promise((resolveWait) => setTimeout(resolveWait, 250));
  }
}

async function startPreview(): Promise<{ url: string; stop: () => void }> {
  const port = await freePort();
  const child = spawn("bunx", ["vite", "preview", "--host", "127.0.0.1", "--port", String(port), "--strictPort"], {
    cwd: API_DIR,
    detached: true,
    stdio: "ignore",
  });
  const url = `http://127.0.0.1:${port}`;
  const stop = () => {
    if (child.pid !== undefined && child.exitCode === null) {
      try {
        process.kill(-child.pid, "SIGTERM");
      } catch {}
    }
  };
  try {
    await waitForOk(`${url}/app`, child);
  } catch (error) {
    stop();
    throw error;
  }
  return { url, stop };
}

const COMPRESSIBLE = /^(text\/|application\/(javascript|json)|image\/svg)/u;

const SIGNED_OUT = JSON.stringify({ error: { code: "sign_in_required", message: "Sign in is required." } });

async function startGzipProxy(upstream: string): Promise<{ url: string; server: Server }> {
  const cache = new Map<string, { status: number; headers: [string, string][]; body: Buffer }>();
  const server = createServer((request, response) => {
    void (async () => {
      const path = request.url ?? "/";
      if (path === "/api/browser/session") {
        response.writeHead(401, { "content-type": "application/json", "cache-control": "no-store" }).end(SIGNED_OUT);
        return;
      }
      let entry = cache.get(path);
      if (!entry) {
        const upstreamResponse = await fetch(`${upstream}${path}`, { redirect: "manual" });
        const raw = Buffer.from(await upstreamResponse.arrayBuffer());
        const type = upstreamResponse.headers.get("content-type") ?? "";
        const headers: [string, string][] = [];
        upstreamResponse.headers.forEach((value, name) => {
          if (!["content-length", "content-encoding", "transfer-encoding", "connection", "keep-alive"].includes(name))
            headers.push([name, value]);
        });
        const compress = COMPRESSIBLE.test(type);
        const body = compress ? gzipSync(raw, { level: 6 }) : raw;
        if (compress) headers.push(["content-encoding", "gzip"]);
        entry = { status: upstreamResponse.status, headers, body };
        if (path.startsWith("/assets/")) cache.set(path, entry);
      }
      response.writeHead(entry.status, [...entry.headers, ["content-length", String(entry.body.byteLength)]].flat());
      response.end(entry.body);
    })().catch((error: unknown) => {
      logger.warn(`proxy: ${String(error)}`);
      response.writeHead(502).end();
    });
  });
  return { url: `http://127.0.0.1:${await listen(server)}`, server };
}

const LOAD_OBSERVERS = `(() => {
  const state = { loginMs: null, longTasks: 0, longTaskMs: 0 };
  window.__openbotWebPerf = state;
  new PerformanceObserver((list) => {
    for (const entry of list.getEntries()) {
      if (state.loginMs !== null) continue;
      state.longTasks += 1;
      state.longTaskMs += entry.duration;
    }
  }).observe({ type: "longtask", buffered: true });
  const check = () => {
    if (state.loginMs !== null) return;
    const input = document.querySelector('input[type="email"]');
    if (input && input.getBoundingClientRect().width > 0) state.loginMs = performance.now();
  };
  new MutationObserver(check).observe(document, { childList: true, subtree: true, attributes: true });
})()`;

const READ_LOAD = `(() => {
  const navigation = performance.getEntriesByType("navigation")[0];
  const fcp = performance.getEntriesByName("first-contentful-paint")[0];
  const resources = performance.getEntriesByType("resource");
  let transfer = navigation ? navigation.transferSize : 0;
  let scriptBytes = 0;
  let scripts = 0;
  const loginMs = window.__openbotWebPerf.loginMs ?? 0;
  let loginTransfer = navigation ? navigation.transferSize : 0;
  let loginRequests = 1;
  for (const entry of resources) {
    transfer += entry.transferSize;
    if (entry.startTime < loginMs) {
      loginRequests += 1;
      loginTransfer += entry.transferSize;
    }
    if (entry.name.endsWith(".js")) {
      scripts += 1;
      scriptBytes += entry.encodedBodySize;
    }
  }
  return {
    ttfbMs: navigation ? navigation.responseStart : 0,
    fcpMs: fcp ? fcp.startTime : 0,
    loginMs,
    loginRequests,
    loginTransferKB: loginTransfer / 1024,
    longTasks: window.__openbotWebPerf.longTasks,
    longTaskMs: window.__openbotWebPerf.longTaskMs,
    requests: resources.length + 1,
    transferKB: transfer / 1024,
    scripts,
    scriptKB: scriptBytes / 1024,
  };
})()`;

async function throttlePage(page: Page): Promise<void> {
  if (throttle === "none") return;
  const session = await page.context().newCDPSession(page);
  await session.send("Emulation.setCPUThrottlingRate", { rate: 4 });
  await session.send("Network.enable");
  await session.send("Network.emulateNetworkConditions", {
    offline: false,
    latency: 150,
    downloadThroughput: (1.6 * 1024 * 1024) / 8,
    uploadThroughput: (750 * 1024) / 8,
  });
}

async function loadOnce(context: BrowserContext, url: string, samples: Samples, prefix: string): Promise<void> {
  const page = await context.newPage();
  try {
    await throttlePage(page);
    await page.addInitScript(LOAD_OBSERVERS);
    await page.goto(`${url}/app`, { waitUntil: "commit" });
    await page.waitForFunction("window.__openbotWebPerf?.loginMs !== null", undefined, { timeout: 120_000 });
    await page.waitForLoadState("networkidle");
    const values = await page.evaluate(READ_LOAD);
    assert.ok(isDynamicRecord(values), "The load reading is not an object.");
    for (const [key, value] of Object.entries(values)) if (isNumber(value)) record(samples, `${prefix}.${key}`, value);
  } finally {
    await page.close();
  }
}

async function measureLoad(browser: Browser, samples: Samples): Promise<void> {
  const preview = option("url") ? null : await startPreview();
  const upstream = option("url")?.replace(/\/$/, "") ?? preview?.url;
  assert.ok(upstream);
  const proxy = await startGzipProxy(upstream);
  try {
    for (let run = 0; run < runs; run++) {
      const context = await browser.newContext({ viewport: { width: 1280, height: 800 } });
      try {
        await loadOnce(context, proxy.url, samples, "load.cold");
        await loadOnce(context, proxy.url, samples, "load.warm");
      } finally {
        await context.close();
      }
      logger.info(`load run ${run + 1}/${runs}: login ${samples["load.cold.loginMs"]?.at(-1)} ms cold`);
    }
  } finally {
    proxy.server.close();
    preview?.stop();
  }
}

const STREAM_TOKENS = 2000;
const OTHER_STREAM_TOKENS = 200;
const STORY = "web-workspace--long-conversation";

async function readCalls(page: Page): Promise<Record<string, number>> {
  const calls = await page.evaluate("({ ...globalThis.openbotWebBench.calls })");
  assert.ok(isDynamicRecord(calls), "The bench call counts are not an object.");
  const counts: Record<string, number> = {};
  for (const [name, value] of Object.entries(calls)) if (isNumber(value)) counts[name] = value;
  return counts;
}

function recordCalls(samples: Samples, prefix: string, calls: Record<string, number>, names: Set<string>): void {
  let total = 0;
  for (const name of names) {
    total += calls[name] ?? 0;
    record(samples, `${prefix}.${name}`, calls[name] ?? 0);
  }
  record(samples, `${prefix}.total`, total);
}

const CALL_NAMES = new Set([
  "connect",
  "listHosts",
  "listAgents",
  "conversation",
  "conversationReads",
  "markRead",
  "queue",
  "status",
  "models",
  "getSidebarLayout",
  "accountUsage",
]);

async function measureRuntime(browser: Browser, samples: Samples): Promise<void> {
  assert.ok(storybook, "The runtime phase needs --storybook=<url> from `bun run storybook`.");
  const warmUp = await browser.newPage();
  await warmUp.goto(`${storybook}/iframe.html?id=${STORY}&viewMode=story`);
  await warmUp.getByText("Question 158:").first().waitFor({ timeout: 300_000 });
  await warmUp.close();
  for (let run = 0; run < runs; run++) {
    const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
    try {
      await page.goto(`${storybook}/iframe.html?id=${STORY}&viewMode=story`);
      await page.waitForFunction("globalThis.openbotWebBench !== undefined", undefined, { timeout: 120_000 });
      await page.evaluate("globalThis.openbotWebBench.ready");
      await page.getByText("Question 158:").first().waitFor({ timeout: 60_000 });
      await page.evaluate("globalThis.openbotWebBench.idle()");
      record(samples, "runtime.openMs", await page.evaluate<number>("performance.now()"));

      await page.evaluate("globalThis.openbotWebBench.resetCalls()");
      const marker = `perf-marker-${run}-${Date.now()}`;
      const stop = await startRenderRecording(page, { frames: true, callCounts: false });
      const started = Date.now();
      await page.evaluate(([tokens, text]) => globalThis.openbotWebBench.stream(tokens, text), [
        STREAM_TOKENS,
        marker,
      ] as const);
      await page.getByText(marker).first().waitFor({ timeout: 60_000 });
      record(samples, "runtime.stream.wallMs", Date.now() - started);
      const { values } = await stop();
      for (const [key, value] of Object.entries(values))
        record(samples, `runtime.stream.${key.replace("render.", "")}`, value);
      recordCalls(samples, "runtime.turn.calls", await readCalls(page), CALL_NAMES);

      await page.evaluate("globalThis.openbotWebBench.resetCalls()");
      await page.evaluate(([tokens, text]) => globalThis.openbotWebBench.stream(tokens, text, true), [
        OTHER_STREAM_TOKENS,
        `${marker}-other`,
      ] as const);
      recordCalls(samples, "runtime.otherTurn.calls", await readCalls(page), CALL_NAMES);

      await page.evaluate("globalThis.openbotWebBench.resetCalls()");
      await page.evaluate("window.dispatchEvent(new Event('focus')); globalThis.openbotWebBench.idle()");
      await page.evaluate("globalThis.openbotWebBench.idle()");
      recordCalls(samples, "runtime.focus.calls", await readCalls(page), CALL_NAMES);
      logger.info(`runtime run ${run + 1}/${runs}: ${samples["runtime.stream.scriptMs"]?.at(-1)} ms script`);
    } finally {
      await page.close();
    }
  }
}

declare global {
  var openbotWebBench: { stream(tokens: number, marker: string, other?: boolean): Promise<void> };
}

function parseReport(path: string): Report {
  const parsed = JSON.parse(readFileSync(path, "utf8"));
  assert.ok(isDynamicRecord(parsed) && isDynamicRecord(parsed.metrics), `${path} is not a perf:web report.`);
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
    throttle: String(parsed.throttle ?? ""),
    metrics,
  };
}

function comparison(before: Report, after: Report): string {
  const lines = ["| Metric | Before | After | Change |", "| --- | ---: | ---: | ---: |"];
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

const samples: Samples = {};
if (phases.has("bundle")) measureBundle(samples);
if (phases.has("load") || phases.has("runtime")) {
  const browser = await chromium.launch(
    browserExecutable ? { executablePath: browserExecutable } : { channel: "chrome" },
  );
  try {
    if (phases.has("load")) await measureLoad(browser, samples);
    if (phases.has("runtime")) await measureRuntime(browser, samples);
  } finally {
    await browser.close();
  }
}

const metrics: Record<string, Spread> = {};
for (const [key, values] of Object.entries(samples)) {
  const summary = spread(values);
  if (summary) metrics[key] = summary;
}
const report: Report = {
  label: outName,
  createdAt: new Date().toISOString(),
  commit: execFileSync("git", ["rev-parse", "--short", "HEAD"], { cwd: ROOT, encoding: "utf8" }).trim(),
  runs,
  throttle,
  metrics,
};
mkdirSync(OUT, { recursive: true });
writeFileSync(resolve(OUT, "report.json"), `${JSON.stringify(report, null, 2)}\n`);
const lines = Object.entries(metrics).map(([key, value]) => `${key}: ${value.median} (${value.min}–${value.max})`);
logger.info(`${resolve(OUT, "report.json")}\n${lines.join("\n")}`);
if (comparePath) {
  assert.ok(statSync(comparePath).isFile(), `--compare: ${comparePath} is not a file.`);
  const table = comparison(parseReport(comparePath), report);
  writeFileSync(resolve(OUT, "comparison.md"), `${table}\n`);
  logger.info(`\n${table}`);
}
