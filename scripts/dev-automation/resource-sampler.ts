// A time series of what one app instance holds, for `dev:bench`. Each tick
// reads the `ps` tree under the recorded pid; every few ticks it also reads the
// JS heap and DOM counters of each page over CDP and the main-process heap over
// the Node inspector. Those two are slower and wake the process they read, so
// they run less often than `ps`, which costs the app nothing.

import { execFile } from "node:child_process";
import { promisify } from "node:util";
import type { Logger } from "@openbot/logging";
import type { Browser, CDPSession, Page } from "playwright-core";
import { cpuMetrics, type MetricValues, parseFootprint, processMetrics } from "./bench-stats";
import { collectDescendants, PROCESS_TABLE_PS_ARGS, type ProcessTableRow, parseProcessTable } from "./cpu-sampling";
import type { InspectorClient } from "./inspector-client";
import { readPageMemory } from "./memory-profile";
import { describeTarget } from "./page-url";

const run = promisify(execFile);

export interface ResourceSamplerOptions {
  // Getters: sampling starts at spawn, to catch the startup peak, before CDP
  // and the inspector answer.
  browser: () => Browser | null;
  inspector: () => InspectorClient | null;
  rootPid: number;
  // The app window. Its heap is reported apart from the helper surfaces.
  appPage: () => Page | null;
  logger: Logger;
  intervalMs?: number;
  // Heap and DOM readings every this many ticks.
  heapEvery?: number;
}

export interface ResourceSample {
  atMs: number;
  values: MetricValues;
}

async function readProcessTree(rootPid: number): Promise<ProcessTableRow[]> {
  const { stdout } = await run("ps", PROCESS_TABLE_PS_ARGS, { maxBuffer: 16 * 1_024 * 1_024 });
  return collectDescendants(parseProcessTable(stdout), rootPid);
}

// macOS only. Elsewhere, or for a process the tool may not read, the pid is
// missing from the map and only RSS is reported for it.
async function readFootprints(rows: ProcessTableRow[]): Promise<Map<number, number>> {
  if (process.platform !== "darwin" || rows.length === 0) return new Map();
  try {
    const { stdout } = await run(
      "footprint",
      ["--noCategories", "-f", "bytes", ...rows.flatMap((row) => ["-p", String(row.pid)])],
      { maxBuffer: 16 * 1_024 * 1_024, timeout: 10_000 },
    );
    return parseFootprint(stdout);
  } catch (error) {
    // A process that exits between `ps` and `footprint` fails the whole call.
    const stdout = error instanceof Error && "stdout" in error && typeof error.stdout === "string" ? error.stdout : "";
    return parseFootprint(stdout);
  }
}

function allPages(browser: Browser | null): Page[] {
  return browser?.contexts().flatMap((context) => context.pages()) ?? [];
}

async function withSession<T>(page: Page, use: (session: CDPSession) => Promise<T>): Promise<T | null> {
  let session: CDPSession | null = null;
  try {
    session = await page.context().newCDPSession(page);
    return await use(session);
  } catch {
    // A page that closes while we attach is not a failed run.
    return null;
  } finally {
    await session?.detach().catch(() => undefined);
  }
}

export class ResourceSampler {
  readonly #options: ResourceSamplerOptions;
  readonly #samples: ResourceSample[] = [];
  #previousRows: ProcessTableRow[] | null = null;
  #previousAt = 0;
  #tick = 0;
  #timer: ReturnType<typeof setTimeout> | null = null;
  #running: Promise<void> | null = null;
  #stopped = false;

  constructor(options: ResourceSamplerOptions) {
    this.#options = options;
  }

  async readHeaps(): Promise<MetricValues> {
    const { appPage, logger } = this.#options;
    const browser = this.#options.browser();
    const inspector = this.#options.inspector();
    const values: MetricValues = {};
    if (!browser) return values;
    const app = appPage();
    let rendererHeap = 0;
    let pageCount = 0;
    for (const page of allPages(browser)) {
      const memory = await withSession(page, (session) => readPageMemory(session, describeTarget(page.url())));
      if (!memory) continue;
      pageCount += 1;
      rendererHeap += memory.jsHeapUsedMb;
      if (page === app) {
        values["heap.renderer.app"] = memory.jsHeapUsedMb;
        values["dom.nodes.app"] = memory.nodes;
        values["dom.listeners.app"] = memory.jsEventListeners;
      }
    }
    values["heap.renderer.all"] = Math.round(rendererHeap * 10) / 10;
    values["pages.count"] = pageCount;
    if (inspector) {
      try {
        const heap = await inspector.readHeap();
        values["heap.main"] = heap.heapUsedMb;
        values["heap.main.total"] = heap.heapTotalMb;
        values["heap.main.external"] = heap.externalMb;
        values["heap.main.arrayBuffers"] = heap.arrayBuffersMb;
      } catch (error) {
        logger.warn(`could not read the main heap: ${error instanceof Error ? error.message : String(error)}`);
      }
    }
    return values;
  }

  async #sample(withHeaps: boolean): Promise<ResourceSample> {
    const atMs = Date.now();
    const rows = await readProcessTree(this.#options.rootPid);
    const values: MetricValues = processMetrics(rows, await readFootprints(rows));
    if (this.#previousRows) Object.assign(values, cpuMetrics(this.#previousRows, rows, atMs - this.#previousAt));
    this.#previousRows = rows;
    this.#previousAt = atMs;
    if (withHeaps) Object.assign(values, await this.readHeaps());
    return { atMs, values };
  }

  start(): void {
    const intervalMs = this.#options.intervalMs ?? 1_000;
    const heapEvery = this.#options.heapEvery ?? 5;
    this.#stopped = false;
    const loop = async (): Promise<void> => {
      if (this.#stopped) return;
      const started = Date.now();
      const sample = await this.#sample(this.#tick % heapEvery === 0);
      this.#tick += 1;
      // The first reading has no CPU interval. It still carries RSS.
      this.#samples.push(sample);
      if (this.#stopped) return;
      this.#timer = setTimeout(
        () => {
          this.#running = loop();
        },
        Math.max(intervalMs - (Date.now() - started), 0),
      );
    };
    this.#running = loop();
  }

  async stop(): Promise<ResourceSample[]> {
    this.#stopped = true;
    if (this.#timer) clearTimeout(this.#timer);
    await this.#running;
    return [...this.#samples];
  }

  /**
   * Collects garbage in main and in each page, waits, and reads everything
   * once. CPU in this reading covers the wait only, which is the idle cost
   * after the scenario.
   */
  async settled(waitMs: number): Promise<MetricValues> {
    const { rootPid } = this.#options;
    await this.#options
      .inspector()
      ?.collectGarbage()
      .catch(() => undefined);
    for (const page of allPages(this.#options.browser())) {
      await withSession(page, async (session) => {
        await session.send("HeapProfiler.enable");
        await session.send("HeapProfiler.collectGarbage");
        await session.send("HeapProfiler.disable");
      });
    }
    const before = await readProcessTree(rootPid);
    const startedAt = Date.now();
    await new Promise((resolve) => setTimeout(resolve, waitMs));
    const after = await readProcessTree(rootPid);
    return {
      ...processMetrics(after, await readFootprints(after)),
      ...cpuMetrics(before, after, Date.now() - startedAt),
      ...(await this.readHeaps()),
    };
  }
}
