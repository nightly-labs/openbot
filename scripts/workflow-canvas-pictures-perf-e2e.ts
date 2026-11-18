// Measures how fast the Workflows canvas shows its pictures, on this computer and on a joined server.
//
// Start this worktree's stack with `OPENBOT_DEV_CLIENT_TRANSPORT=webrtc bun run dev:test-client`, so the
// test client reaches the host over Signal and WebRTC, as a user does. On loopback a file comes in at
// about 50 MB/s; add `OPENBOT_DEV_RTT_MS=80 OPENBOT_DEV_DOWNLINK_KBPS=20000` for the round trip and the
// speed of a host on a home or server connection. Then run
// `bun scripts/workflow-canvas-pictures-perf-e2e.ts --allow-mutations [--pictures=12] [--runs=3] [--label=<name>]
//  [--clients=remote,local] [--compare=<old report.json>]`.
//
// Each run makes new pictures on the host (PNG files of about 2.4 MB, as a generated picture is), so no
// cache holds them, and a new workflow with one asset step for each picture. Then, in each client:
// - cold: the client opens the workflow. The time is from the click on the workflow to the first
//   picture, to the pictures in the view, and to all pictures that show.
// - warm: the client opens another workflow and then this one again.
// - result: with the canvas open, the host adds a step with a new picture, as a finished image step
//   does. The time is from the host's save to the picture on the client's canvas.
// `remote` is the test client on the joined host. `local` is the host app on its own workflow.
// Writes .openbot-build/workflow-canvas-pictures-perf/<label>/report.json and summary.md, and with
// --compare also comparison.md.
import assert from "node:assert/strict";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { createOpenBotLogger } from "@openbot/logging";
import type { Page } from "playwright-core";
import { argument } from "./channel-e2e-support";
import { type Spread, spread } from "./dev-automation/bench-stats";
import { assertMutationAllowed, connectToDevApp } from "./dev-automation/cdp-client";
import { type DevInstanceRecord, readDevInstanceRecords } from "./dev-automation/instance-registry";

const NAME = "workflow-canvas-pictures-perf";
const ROOT = resolve(import.meta.dirname, "..");
const HOST_NAME = "OpenBot Local Dev Host";
const PICTURE_SIDE = 1024;
const COLUMNS = 4;
const SPACING = 380;
const WAIT_MS = 120_000;
const logger = createOpenBotLogger(NAME);

const pictureCount = Number(argument("pictures") ?? "12");
const runs = Number(argument("runs") ?? "3");
const label = argument("label") ?? "run";
const clients = (argument("clients") ?? "remote,local").split(",").filter(Boolean);
const compare = argument("compare");
const allowMutations = process.argv.includes("--allow-mutations");
const outDir = join(ROOT, ".openbot-build", NAME, label);

interface PictureTimes {
  /** From the click to the first picture element on the canvas: the reads before any download. */
  mountMs: number;
  /** From the click to the first picture that shows. */
  firstMs: number;
  /** To the last picture that was in the view when all pictures showed. */
  viewMs: number;
  /** To the last picture. */
  allMs: number;
  /** The pixel width of each picture that the canvas shows. A preview is narrower than the file. */
  widths: number[];
}

interface ClientRun {
  cold: PictureTimes;
  warm: PictureTimes;
  /** From the host's save of the new step to its picture on this client's canvas. */
  resultMs: number;
}

/** The marks of one canvas open, which the page keeps between two checks. */
interface CanvasPictures {
  start: number;
  mounted: Map<string, number>;
  shown: Map<string, number>;
}

declare global {
  interface Window {
    __canvasPictures?: CanvasPictures;
  }
}

/** The value of a page check. The check ends only on a value, so `false` never comes back. */
async function answered<T>(handle: { jsonValue(): Promise<T | false> }): Promise<T> {
  const value = await handle.jsonValue();
  assert.ok(value !== false, "The page check answered no value.");
  return value;
}

/** The client reports of an earlier `report.json`. */
function savedReports(saved: unknown, path: string): ClientReport[] {
  assert.ok(
    typeof saved === "object" && saved !== null && "reports" in saved && Array.isArray(saved.reports),
    `${path} has no reports.`,
  );
  return saved.reports;
}

interface ClientReport {
  client: string;
  runs: ClientRun[];
  coldMount: Spread;
  coldFirst: Spread;
  coldView: Spread;
  coldAll: Spread;
  warmAll: Spread;
  result: Spread;
}

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

/** Makes a PNG of about 2.4 MB on the host page and keeps it as a picture of the host. Answers its id. */
async function makePicture(host: Page, name: string): Promise<string> {
  return host.evaluate(
    async ({ name, side }) => {
      const canvas = new OffscreenCanvas(side, side);
      const context = canvas.getContext("2d");
      if (!context) throw new Error("No 2D context.");
      const image = context.createImageData(side, side);
      const tint = Math.random() * 255;
      for (let index = 0; index < image.data.length; index += 4) {
        const pixel = index / 4;
        const x = pixel % side;
        const y = Math.floor(pixel / side);
        image.data[index] = (x / 4 + tint + Math.random() * 64) & 0xfc;
        image.data[index + 1] = (y / 4 + Math.random() * 64) & 0xfc;
        image.data[index + 2] = ((x + y) / 8 + Math.random() * 64) & 0xfc;
        image.data[index + 3] = 255;
      }
      context.putImageData(image, 0, 0);
      const blob = await canvas.convertToBlob({ type: "image/png" });
      const bytes = new Uint8Array(await blob.arrayBuffer());
      const [draft] = await window.openbot.agent.importAttachmentData([{ name, mimeType: "image/png", bytes }]);
      if (!draft) throw new Error("The host kept no draft.");
      return window.openbot.workflows.keepPicture(draft.id);
    },
    { name, side: PICTURE_SIDE },
  );
}

function assetNode(index: number, fileId: string, name: string) {
  return {
    id: `asset-${index}`,
    kind: "asset" as const,
    at: { x: (index % COLUMNS) * SPACING, y: Math.floor(index / COLUMNS) * SPACING },
    fields: { file: name, fileId },
  };
}

/** Makes a workflow on the host with one asset step for each new picture. */
async function seedWorkflow(host: Page, title: string) {
  const nodes = [];
  for (let index = 0; index < pictureCount; index += 1) {
    const name = `${title}-${index}.png`.replaceAll(" ", "-");
    nodes.push(assetNode(index, await makePicture(host, name), name));
  }
  const created = await host.evaluate((input) => window.openbot.workflows.create(input), {
    title,
    graph: { nodes, edges: [], strokes: [] },
  });
  return { workflowId: created.summary.id, nodes };
}

/** Opens a page of the given server in the app window. */
async function openWorkflows(page: Page, serverName: string): Promise<void> {
  const serverMenu = page.getByRole("button", { name: /^Open server menu for / });
  if ((await serverMenu.getAttribute("aria-label")) !== `Open server menu for ${serverName}`) {
    await serverMenu.click();
    await page.getByRole("menuitem", { name: serverName, exact: true }).click();
    await page.getByRole("button", { name: `Open server menu for ${serverName}`, exact: true }).waitFor();
  }
  await page.getByRole("navigation", { name: "Pages" }).getByRole("button", { name: "Workflows", exact: true }).click();
  await page.getByRole("main", { name: /^Workflow canvas: / }).waitFor({ timeout: WAIT_MS });
}

/** Clicks the workflow in the switcher, and answers when `expected` pictures show on the canvas. */
async function openWorkflow(page: Page, title: string, expected: number): Promise<PictureTimes> {
  const canvas = page.getByRole("main", { name: /^Workflow canvas: / });
  const current = (await canvas.getAttribute("aria-label"))?.replace(/^Workflow canvas: /, "") ?? "";
  await canvas.getByRole("button", { name: current, exact: true }).first().click();
  const item = page.getByRole("menuitem", { name: new RegExp(`^${title} `) });
  await item.waitFor();
  await page.evaluate(() => {
    // Marks by picture address: the canvas keeps an image element when only its address changes.
    const state = { start: 0, mounted: new Map<string, number>(), shown: new Map<string, number>() };
    window.__canvasPictures = state;
    document.addEventListener(
      "click",
      () => {
        if (state.start === 0) state.start = performance.now();
      },
      { capture: true, once: true },
    );
  });
  await item.click();
  return page
    .waitForFunction(
      ({ count, title }) => {
        const state = window.__canvasPictures;
        if (!state) return false;
        const now = performance.now();
        const main = document.querySelector(`main[aria-label="Workflow canvas: ${CSS.escape(title)}"]`);
        const viewport = document.querySelector(".wfn-viewport")?.getBoundingClientRect();
        if (!main || !viewport) return false;
        const pictures = [...document.querySelectorAll<HTMLImageElement>(".wfn-viewport img.wfn-media")];
        for (const picture of pictures) {
          if (!state.mounted.has(picture.src)) state.mounted.set(picture.src, now);
          if (picture.complete && picture.naturalWidth > 0 && !state.shown.has(picture.src))
            state.shown.set(picture.src, now);
        }
        const shown = pictures.filter((picture) => state.shown.has(picture.src));
        if (shown.length < count || pictures.length < count) return false;
        const at = (picture: HTMLImageElement) => (state.shown.get(picture.src) ?? now) - state.start;
        const times = shown.map(at);
        const inView = shown
          .filter((picture) => {
            const box = picture.getBoundingClientRect();
            return (
              box.right > viewport.left &&
              box.left < viewport.right &&
              box.bottom > viewport.top &&
              box.top < viewport.bottom
            );
          })
          .map(at);
        const mounted = pictures.map((picture) => (state.mounted.get(picture.src) ?? now) - state.start);
        return {
          mountMs: Math.round(mounted.length ? Math.min(...mounted) : 0),
          firstMs: Math.round(times.length ? Math.min(...times) : 0),
          viewMs: Math.round(inView.length ? Math.max(...inView) : 0),
          allMs: Math.round(times.length ? Math.max(...times) : 0),
          widths: shown.map((picture) => picture.naturalWidth),
        };
      },
      { count: expected, title },
      { polling: "raf", timeout: WAIT_MS },
    )
    .then(answered);
}

/** With the canvas open on the client, the host adds a step with a new picture. Answers the time to show it. */
async function newResult(host: Page, client: Page, workflowId: string, title: string, count: number) {
  const name = `${title}-result.png`.replaceAll(" ", "-");
  const fileId = await makePicture(host, name);
  const savedAt = await host.evaluate(
    async ({ workflowId, node }) => {
      const detail = await window.openbot.workflows.get(workflowId);
      const graph = { ...detail.graph, nodes: [...detail.graph.nodes, node] };
      const answer = await window.openbot.workflows.saveGraph({ workflowId, baseRevision: detail.revision, graph });
      if (!answer.ok) throw new Error("The save had a conflict.");
      return Date.now();
    },
    { workflowId, node: assetNode(count, fileId, name) },
  );
  const shownAt = await client
    .waitForFunction(
      (expected) => {
        const shown = [...document.querySelectorAll<HTMLImageElement>(".wfn-viewport img.wfn-media")].filter(
          (picture) => picture.complete && picture.naturalWidth > 0,
        );
        return shown.length >= expected ? Date.now() : false;
      },
      count + 1,
      { polling: "raf", timeout: WAIT_MS },
    )
    .then(answered);
  return shownAt - savedAt;
}

async function measureClient(clientName: string): Promise<ClientReport> {
  const hostSession = await connect(instance("app"));
  const clientSession = clientName === "remote" ? await connect(instance("test-client")) : hostSession;
  const host = hostSession.page;
  const page = clientSession.page;
  try {
    await openWorkflows(page, HOST_NAME);
    // A second workflow to switch to, so that the warm open mounts the canvas again.
    const other = `Perf other ${label}`;
    const listed = await host.evaluate(() => window.openbot.workflows.list());
    if (!listed.some((summary) => summary.title === other))
      await host.evaluate((title) => window.openbot.workflows.create({ title }), other);
    const result: ClientRun[] = [];
    for (let run = 0; run < runs; run += 1) {
      const title = `Perf ${label} ${clientName} ${Date.now()}`;
      const { workflowId } = await seedWorkflow(host, title);
      logger.info(`${clientName} run ${run + 1}/${runs}: seeded ${pictureCount} pictures`);
      const cold = await openWorkflow(page, title, pictureCount);
      await openWorkflow(page, other, 0);
      const warm = await openWorkflow(page, title, pictureCount);
      const resultMs = await newResult(host, page, workflowId, title, pictureCount);
      result.push({ cold, warm, resultMs });
      logger.info(
        `${clientName} run ${run + 1}: cold all ${cold.allMs} ms, warm all ${warm.allMs} ms, result ${resultMs} ms`,
      );
    }
    return {
      client: clientName,
      runs: result,
      coldMount: spreadOf(result.map((run) => run.cold.mountMs)),
      coldFirst: spreadOf(result.map((run) => run.cold.firstMs)),
      coldView: spreadOf(result.map((run) => run.cold.viewMs)),
      coldAll: spreadOf(result.map((run) => run.cold.allMs)),
      warmAll: spreadOf(result.map((run) => run.warm.allMs)),
      result: spreadOf(result.map((run) => run.resultMs)),
    };
  } finally {
    if (clientSession !== hostSession) await clientSession.close();
    await hostSession.close();
  }
}

const METRICS = ["coldMount", "coldFirst", "coldView", "coldAll", "warmAll", "result"] as const;

function summary(reports: readonly ClientReport[]): string {
  const lines = [
    `# Canvas pictures: ${label}`,
    "",
    `${pictureCount} pictures of ${PICTURE_SIDE} px, ${runs} runs. Median (min-max) in ms.`,
    "",
    `| Client | ${METRICS.join(" | ")} | width shown |`,
    `| --- | ${METRICS.map(() => "---").join(" | ")} | --- |`,
  ];
  for (const report of reports) {
    const width = report.runs[0]?.cold.widths[0] ?? 0;
    lines.push(
      `| ${report.client} | ${METRICS.map((metric) => `${report[metric].median} (${report[metric].min}-${report[metric].max})`).join(" | ")} | ${width} |`,
    );
  }
  return `${lines.join("\n")}\n`;
}

function comparison(before: readonly ClientReport[], after: readonly ClientReport[]): string {
  const lines = [`| Client | Metric | Before | After | Change |`, `| --- | --- | --- | --- | --- |`];
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

const reports: ClientReport[] = [];
for (const client of clients) reports.push(await measureClient(client));
mkdirSync(outDir, { recursive: true });
writeFileSync(
  join(outDir, "report.json"),
  `${JSON.stringify({ label, pictureCount, pictureSide: PICTURE_SIDE, runs, at: new Date().toISOString(), reports }, null, 2)}\n`,
);
writeFileSync(join(outDir, "summary.md"), summary(reports));
if (compare) {
  assert.ok(existsSync(compare), `${compare} is missing.`);
  const before = savedReports(JSON.parse(readFileSync(compare, "utf8")), compare);
  writeFileSync(join(outDir, "comparison.md"), comparison(before, reports));
}
logger.info(`wrote ${join(outDir, "report.json")}`);
process.stdout.write(summary(reports));
