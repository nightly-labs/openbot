// Collects what `cpu-sampling.ts` summarizes for `dev:automation memory`: one
// `ps` reading of the instance's process tree, and the JS heap and DOM counters
// of each page CDP can reach. Read-only: nothing here changes app state. A heap
// snapshot pauses the page it is taken from for a moment, and writes only under
// the build directory.

import { execFile } from "node:child_process";
import { createWriteStream } from "node:fs";
import { mkdir } from "node:fs/promises";
import { dirname } from "node:path";
import { promisify } from "node:util";
import type { Logger } from "@openbot/logging";
import type { Browser, CDPSession, Page } from "playwright-core";
import {
  collectDescendants,
  type MemoryReport,
  PROCESS_TABLE_PS_ARGS,
  parseProcessTable,
  summarizeMemory,
} from "./cpu-sampling";
import { describeTarget } from "./page-url";

const run = promisify(execFile);
const BYTES_PER_MB = 1_024 * 1_024;

export interface PageMemory {
  target: string;
  jsHeapUsedMb: number;
  jsHeapTotalMb: number;
  documents: number;
  nodes: number;
  jsEventListeners: number;
}

export interface MemoryProfile extends MemoryReport {
  pages: PageMemory[];
}

export interface MemoryProfileOptions {
  browser: Browser;
  // From the instance registry. Without it the process tree cannot be found
  // without matching by name, which would count another worktree's app.
  rootPid: number | null;
  label: string;
  logger: Logger;
}

async function readPageMemory(session: CDPSession, target: string): Promise<PageMemory> {
  await session.send("Performance.enable");
  const { metrics } = await session.send("Performance.getMetrics");
  await session.send("Performance.disable").catch(() => undefined);
  const counters = await session.send("Memory.getDOMCounters");
  const metric = (name: string) => metrics.find((one) => one.name === name)?.value ?? 0;
  return {
    target,
    jsHeapUsedMb: round(metric("JSHeapUsedSize") / BYTES_PER_MB),
    jsHeapTotalMb: round(metric("JSHeapTotalSize") / BYTES_PER_MB),
    documents: counters.documents,
    nodes: counters.nodes,
    jsEventListeners: counters.jsEventListeners,
  };
}

async function measurePages(pages: Page[], logger: Logger): Promise<PageMemory[]> {
  const measured: PageMemory[] = [];
  for (const page of pages) {
    const target = describeTarget(page.url());
    let session: CDPSession | null = null;
    try {
      session = await page.context().newCDPSession(page);
      measured.push(await readPageMemory(session, target));
    } catch {
      // A page that closes while we attach cannot be reported, and must not
      // take the process-level numbers down with it.
      logger.warn(`could not read memory counters of ${target}`);
    } finally {
      await session?.detach().catch(() => undefined);
    }
  }
  return measured.sort((left, right) => right.jsHeapUsedMb - left.jsHeapUsedMb);
}

export async function profileMemory(options: MemoryProfileOptions): Promise<MemoryProfile> {
  const { browser, rootPid, label, logger } = options;
  const pages = await measurePages(
    browser.contexts().flatMap((context) => context.pages()),
    logger,
  );
  if (rootPid === null) {
    logger.warn("no registry record published a pid, so process memory is not reported.");
    return { ...summarizeMemory([], label), pages };
  }
  const { stdout } = await run("ps", PROCESS_TABLE_PS_ARGS, { maxBuffer: 16 * BYTES_PER_MB });
  return { ...summarizeMemory(collectDescendants(parseProcessTable(stdout), rootPid), label), pages };
}

/** Writes a V8 heap snapshot of one page to `outPath`, streamed chunk by chunk. */
export async function writeHeapSnapshot(page: Page, outPath: string, logger: Logger): Promise<void> {
  await mkdir(dirname(outPath), { recursive: true });
  const session = await page.context().newCDPSession(page);
  const file = createWriteStream(outPath);
  try {
    session.on("HeapProfiler.addHeapSnapshotChunk", ({ chunk }) => {
      file.write(chunk);
    });
    await session.send("HeapProfiler.enable");
    await session.send("HeapProfiler.collectGarbage");
    await session.send("HeapProfiler.takeHeapSnapshot", { reportProgress: false });
    await session.send("HeapProfiler.disable").catch(() => undefined);
  } finally {
    await new Promise<void>((resolve, reject) => {
      file.once("error", reject);
      file.end(resolve);
    });
    await session.detach().catch(() => undefined);
  }
  logger.info(`heap snapshot of ${describeTarget(page.url())} written`);
}

function round(value: number): number {
  return Math.round(value * 10) / 10;
}
