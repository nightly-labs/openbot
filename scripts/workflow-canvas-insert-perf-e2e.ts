import assert from "node:assert/strict";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { createOpenBotLogger } from "@openbot/logging";
import type { CDPSession, Page } from "playwright-core";
import { argument } from "./channel-e2e-support";
import { type Spread, spread } from "./dev-automation/bench-stats";
import { assertMutationAllowed, connectToDevApp } from "./dev-automation/cdp-client";
import { type DevInstanceRecord, readDevInstanceRecords } from "./dev-automation/instance-registry";

const NAME = "workflow-canvas-insert-perf";
const ROOT = resolve(import.meta.dirname, "..");
const HOST_NAME = "OpenBot Local Dev Host";
const PHOTO_WIDTH = 2400;
const PHOTO_HEIGHT = 1800;
const WAIT_MS = 120_000;
const FILMSTRIP_MARKS = [0, 100, 250, 500, 1000, 2000, 3000, 5000];
const logger = createOpenBotLogger(NAME);

const photoCount = Number(argument("pictures") ?? "6");
const runs = Number(argument("runs") ?? "3");
const label = argument("label") ?? "run";
const clients = (argument("clients") ?? "local,remote").split(",").filter(Boolean);
const compare = argument("compare");
const allowMutations = process.argv.includes("--allow-mutations");
const outDir = join(ROOT, ".openbot-build", NAME, label);

interface InsertTimes {
  feedbackMs: number;
  firstPictureMs: number;
  nodesMs: number;
  allMs: number;
  photoBytes: number;
}

interface InsertProbe {
  start: number;
  wallStart: number;
  result: Promise<InsertTimes>;
}

declare global {
  interface Window {
    __insertFiles?: File[];
    __insertProbe?: InsertProbe;
  }
}

interface ClientReport {
  client: string;
  runs: InsertTimes[];
  feedback: Spread;
  firstPicture: Spread;
  nodes: Spread;
  all: Spread;
}

const METRICS = ["feedback", "firstPicture", "nodes", "all"] as const;

function spreadOf(values: readonly number[]): Spread {
  const result = spread(values);
  assert.ok(result, "A metric has no values.");
  return result;
}

function instance(service: DevInstanceRecord["service"]): DevInstanceRecord {
  const found = readDevInstanceRecords().filter(
    (record) => record.service === service && resolve(record.projectRoot) === ROOT,
  );
  assert.equal(found.length, 1, `Expected one ${service} instance of this worktree. Start dev:test-client.`);
  const [record] = found;
  assert.ok(record);
  return record;
}

async function connect(record: DevInstanceRecord) {
  assertMutationAllowed({
    command: NAME,
    allowMutations,
    instanceNamed: true,
    target: `${record.service} ${record.instanceId}`,
  });
  return connectToDevApp(record.remoteDebuggingPort, logger, {
    expectedRendererPort: record.rendererPort,
    ownerPid: record.pid,
  });
}

async function showPage(page: Page): Promise<CDPSession> {
  const cdp = await page.context().newCDPSession(page);
  await cdp.send("Emulation.setFocusEmulationEnabled", { enabled: true });
  await cdp.send("Page.bringToFront");
  return cdp;
}

async function openWorkflows(page: Page): Promise<void> {
  const serverMenu = page.getByRole("button", { name: /^Open server menu for / });
  if ((await serverMenu.getAttribute("aria-label")) !== `Open server menu for ${HOST_NAME}`) {
    await serverMenu.click();
    await page.getByRole("menuitem", { name: HOST_NAME, exact: true }).click();
    await page.getByRole("button", { name: `Open server menu for ${HOST_NAME}`, exact: true }).waitFor();
  }
  await page.getByRole("navigation", { name: "Pages" }).getByRole("button", { name: "Workflows", exact: true }).click();
  await page.getByRole("main", { name: /^Workflow canvas: / }).waitFor({ timeout: WAIT_MS });
}

async function openWorkflow(page: Page, title: string): Promise<void> {
  const canvas = page.getByRole("main", { name: /^Workflow canvas: / });
  await canvas.locator("button.wfn-corner-trigger").first().click();
  await page.getByRole("menuitem", { name: new RegExp(`^${title} `) }).click();
  await page.locator(`main[aria-label="Workflow canvas: ${title}"]`).waitFor({ timeout: WAIT_MS });
  await page.locator(".wfn-viewport").waitFor({ timeout: WAIT_MS });
}

async function makePhotos(page: Page, title: string): Promise<number> {
  return page.evaluate(
    async ({ count, width, height, title }) => {
      const files: File[] = [];
      for (let index = 0; index < count; index += 1) {
        const canvas = new OffscreenCanvas(width, height);
        const context = canvas.getContext("2d");
        if (!context) throw new Error("No 2D context.");
        const image = context.createImageData(width, height);
        const tint = Math.random() * 255;
        for (let at = 0; at < image.data.length; at += 4) {
          const pixel = at / 4;
          const x = pixel % width;
          const y = Math.floor(pixel / width);
          image.data[at] = (x / 10 + tint + Math.random() * 40) & 0xff;
          image.data[at + 1] = (y / 8 + Math.random() * 40) & 0xff;
          image.data[at + 2] = ((x + y) / 16 + Math.random() * 40) & 0xff;
          image.data[at + 3] = 255;
        }
        context.putImageData(image, 0, 0);
        const blob = await canvas.convertToBlob({ type: "image/jpeg", quality: 0.9 });
        files.push(new File([blob], `${title}-${index}.jpg`.replaceAll(" ", "-"), { type: "image/jpeg" }));
      }
      window.__insertFiles = files;
      return files.reduce((total, file) => total + file.size, 0);
    },
    { count: photoCount, width: PHOTO_WIDTH, height: PHOTO_HEIGHT, title },
  );
}

async function dropPhotos(page: Page): Promise<number> {
  return page.evaluate((count) => {
    const files = window.__insertFiles;
    const viewport = document.querySelector<HTMLElement>(".wfn-viewport");
    if (!files || !viewport) throw new Error("No photos or no canvas.");
    const shown = (picture: HTMLImageElement) => picture.complete && picture.naturalWidth > 0;
    const start = performance.now();
    const wallStart = Date.now();
    let settle: (times: InsertTimes) => void = () => undefined;
    const result = new Promise<InsertTimes>((done) => {
      settle = done;
    });
    const times = { feedbackMs: -1, firstPictureMs: -1, nodesMs: -1, allMs: -1 };
    const check = () => {
      const now = Math.round(performance.now() - start);
      const arriving = [...document.querySelectorAll(".wfn-arriving")];
      const nodes = [...viewport.querySelectorAll("[data-node-id]")];
      if (times.feedbackMs < 0 && arriving.length + nodes.length > 0) times.feedbackMs = now;
      const pictures = [
        ...viewport.querySelectorAll<HTMLImageElement>(".wfn-arriving img.wfn-media, [data-node-id] img.wfn-media"),
      ];
      if (times.firstPictureMs < 0 && pictures.some(shown)) times.firstPictureMs = now;
      if (times.nodesMs < 0 && nodes.length >= count) times.nodesMs = now;
      const nodePictures = nodes.map((node) => node.querySelector<HTMLImageElement>("img.wfn-media"));
      if (
        times.nodesMs >= 0 &&
        arriving.length === 0 &&
        nodePictures.every((picture) => picture !== null && shown(picture))
      ) {
        times.allMs = now;
        observer.disconnect();
        document.removeEventListener("load", check, true);
        settle({ ...times, photoBytes: files.reduce((total, file) => total + file.size, 0) });
      }
    };
    const observer = new MutationObserver(check);
    observer.observe(viewport, { childList: true, subtree: true, attributes: true, attributeFilter: ["src"] });
    document.addEventListener("load", check, true);
    window.__insertProbe = { start, wallStart, result };
    const box = viewport.getBoundingClientRect();
    const transfer = new DataTransfer();
    for (const file of files) transfer.items.add(file);
    viewport.dispatchEvent(
      new DragEvent("drop", {
        bubbles: true,
        cancelable: true,
        dataTransfer: transfer,
        clientX: box.left + box.width * 0.3,
        clientY: box.top + box.height * 0.3,
      }),
    );
    check();
    return wallStart;
  }, photoCount);
}

async function insertResult(page: Page): Promise<InsertTimes> {
  return page.evaluate(() => {
    const probe = window.__insertProbe;
    if (!probe) throw new Error("No insert probe.");
    return probe.result;
  });
}

interface Frame {
  at: number;
  data: string;
}

async function recordFrames(cdp: CDPSession): Promise<{ frames: Frame[]; stop: () => Promise<void> }> {
  const frames: Frame[] = [];
  cdp.on("Page.screencastFrame", (frame) => {
    frames.push({ at: Math.round((frame.metadata.timestamp ?? 0) * 1000), data: frame.data });
    void cdp.send("Page.screencastFrameAck", { sessionId: frame.sessionId }).catch(() => undefined);
  });
  await cdp.send("Page.startScreencast", { format: "jpeg", quality: 80, everyNthFrame: 1 });
  return { frames, stop: () => cdp.send("Page.stopScreencast").then(() => undefined) };
}

function writeFilmstrip(client: string, frames: readonly Frame[], wallStart: number, allMs: number): string[] {
  const dir = join(outDir, `filmstrip-${client}`);
  rmSync(dir, { recursive: true, force: true });
  mkdirSync(dir, { recursive: true });
  const written: string[] = [];
  const marks = [...FILMSTRIP_MARKS.filter((mark) => mark < allMs), allMs];
  for (const mark of marks) {
    const before = frames.filter((frame) => frame.at - wallStart <= mark);
    const frame = before.at(-1) ?? frames[0];
    if (!frame) continue;
    const path = join(dir, `${String(mark).padStart(5, "0")}ms.jpg`);
    writeFileSync(path, Buffer.from(frame.data, "base64"));
    written.push(path);
  }
  return written;
}

async function measureClient(clientName: string): Promise<ClientReport> {
  const hostSession = await connect(instance("app"));
  const clientSession = clientName === "remote" ? await connect(instance("test-client")) : hostSession;
  const host = hostSession.page;
  const page = clientSession.page;
  const cdp = await showPage(page);
  try {
    await openWorkflows(page);
    const result: InsertTimes[] = [];
    for (let run = 0; run < runs; run += 1) {
      const title = `Insert ${label} ${clientName} ${Date.now()}`;
      await host.evaluate((input) => window.openbot.workflows.create(input), {
        title,
        graph: { nodes: [], edges: [], strokes: [] },
      });
      await openWorkflow(page, title);
      await makePhotos(page, title);
      const recording = run === 0 ? await recordFrames(cdp) : null;
      const wallStart = await dropPhotos(page);
      const times = await insertResult(page);
      if (recording) {
        await page.waitForTimeout(300);
        await recording.stop();
        writeFilmstrip(clientName, recording.frames, wallStart, times.allMs);
      }
      result.push(times);
      logger.info(
        `${clientName} run ${run + 1}/${runs}: card ${times.feedbackMs} ms, first picture ${times.firstPictureMs} ms, nodes ${times.nodesMs} ms, all pictures ${times.allMs} ms`,
      );
    }
    return {
      client: clientName,
      runs: result,
      feedback: spreadOf(result.map((run) => run.feedbackMs)),
      firstPicture: spreadOf(result.map((run) => run.firstPictureMs)),
      nodes: spreadOf(result.map((run) => run.nodesMs)),
      all: spreadOf(result.map((run) => run.allMs)),
    };
  } finally {
    await cdp.detach().catch(() => undefined);
    if (clientSession !== hostSession) await clientSession.close();
    await hostSession.close();
  }
}

function summary(reports: readonly ClientReport[]): string {
  const bytes = reports[0]?.runs[0]?.photoBytes ?? 0;
  const lines = [
    `# Canvas insert: ${label}`,
    "",
    `${photoCount} JPEG photos of ${PHOTO_WIDTH}x${PHOTO_HEIGHT} px (${(bytes / 1_048_576).toFixed(1)} MB), ${runs} runs. Median (min-max) in ms.`,
    "",
    `| Client | ${METRICS.join(" | ")} |`,
    `| --- | ${METRICS.map(() => "---").join(" | ")} |`,
  ];
  for (const report of reports)
    lines.push(
      `| ${report.client} | ${METRICS.map((metric) => `${report[metric].median} (${report[metric].min}-${report[metric].max})`).join(" | ")} |`,
    );
  return `${lines.join("\n")}\n`;
}

function savedReports(saved: unknown, path: string): ClientReport[] {
  assert.ok(
    typeof saved === "object" && saved !== null && "reports" in saved && Array.isArray(saved.reports),
    `${path} has no reports.`,
  );
  return saved.reports;
}

function comparison(before: readonly ClientReport[], after: readonly ClientReport[]): string {
  const lines = ["| Client | Metric | Before | After | Change |", "| --- | --- | --- | --- | --- |"];
  for (const report of after) {
    const old = before.find((entry) => entry.client === report.client);
    if (!old) continue;
    for (const metric of METRICS) {
      const from = old[metric].median;
      const to = report[metric].median;
      const change = from > 0 ? `${Math.round(((to - from) / from) * 100)}%` : "-";
      lines.push(`| ${report.client} | ${metric} | ${from} | ${to} | ${change} |`);
    }
  }
  return `${lines.join("\n")}\n`;
}

mkdirSync(outDir, { recursive: true });
const reports: ClientReport[] = [];
for (const client of clients) reports.push(await measureClient(client));
writeFileSync(
  join(outDir, "report.json"),
  `${JSON.stringify(
    {
      label,
      photoCount,
      photoSide: [PHOTO_WIDTH, PHOTO_HEIGHT],
      runs,
      roundTripMs: Number(process.env.OPENBOT_DEV_RTT_MS) || 0,
      downlinkKbps: Number(process.env.OPENBOT_DEV_DOWNLINK_KBPS) || 0,
      at: new Date().toISOString(),
      reports,
    },
    null,
    2,
  )}\n`,
);
writeFileSync(join(outDir, "summary.md"), summary(reports));
if (compare) {
  assert.ok(existsSync(compare), `${compare} is missing.`);
  writeFileSync(
    join(outDir, "comparison.md"),
    comparison(savedReports(JSON.parse(readFileSync(compare, "utf8")), compare), reports),
  );
}
logger.info(`wrote ${join(outDir, "report.json")}`);
process.stdout.write(summary(reports));
process.exit(0);
