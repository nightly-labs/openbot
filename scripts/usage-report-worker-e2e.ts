import assert from "node:assert/strict";
import { mkdirSync, writeFileSync } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import type { HostAnalyticsInput } from "@openbot/contracts/ipc";
import { Effect } from "effect";
import { build } from "esbuild";
import { readUsageReportInWorker } from "../src/backend/database/usage-report-reader";
import { runCauseEffect } from "../src/backend/effect-boundary";
import { OpenBotDatabase } from "../src/backend/openbot-database";

const ROOT = resolve(import.meta.dirname, "..");
const OUT = join(ROOT, ".openbot-build/usage-report-worker-e2e");
const DAY_MS = 86_400_000;
const RECORDS = 60_000;
const ACTIVITY = 30_000;
const SKILL_LOADS = 10_000;
const AGENTS = 24;
const TICK_MS = 10;
const ACTIVITY_KINDS = ["turn", "user", "assistant"];
const TIME_ZONES = ["Europe/Warsaw", "Asia/Kathmandu", "America/St_Johns", "UTC"];

interface Run {
  name: string;
  mainMs: number;
  workerMs: number;
  longestMainGapDuringWorkerMs: number;
}

interface Report {
  records: number;
  runs: Run[];
  checks: string[];
  passed: boolean;
}

const report: Report = { records: RECORDS, runs: [], checks: [], passed: false };

function day(offset: number): string {
  return new Date(Date.now() + offset * DAY_MS).toISOString().slice(0, 10);
}

function seed(database: OpenBotDatabase): void {
  const db = database.connection;
  const start = Math.floor(Date.now() / DAY_MS) * DAY_MS - 20 * DAY_MS + 12_345;
  const tokens = JSON.stringify({ uncachedInput: 1200, cachedInput: 40000, cacheCreation: 300, output: 800 });
  const record = db.prepare("INSERT INTO agent_usage_records VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)");
  const activity = db.prepare("INSERT INTO agent_usage_activity VALUES (?, ?, ?, ?, ?, ?, ?, ?)");
  const skill = db.prepare("INSERT INTO agent_usage_skill_loads VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)");
  db.exec("BEGIN");
  for (let i = 0; i < RECORDS; i++) {
    const at = new Date(start + i * 29_000).toISOString();
    const claude = i % 3 !== 0;
    record.run(
      `agent-${i % AGENTS}`,
      `r-${i}`,
      `s-${i % 500}`,
      `t-${i >> 2}`,
      claude ? "claude" : "codex",
      claude ? "claude-opus-5-5" : "gpt-5.5",
      at,
      tokens,
      0.05,
      "list",
      at,
    );
  }
  for (let i = 0; i < ACTIVITY; i++) {
    const at = new Date(start + i * 57_000).toISOString();
    activity.run(
      `agent-${i % AGENTS}`,
      `a-${i}`,
      `s-${i % 500}`,
      `t-${i >> 1}`,
      "claude",
      "claude-opus-5-5",
      ACTIVITY_KINDS[i % 3] ?? "turn",
      at,
    );
  }
  for (let i = 0; i < SKILL_LOADS; i++) {
    const at = new Date(start + i * 170_000).toISOString();
    skill.run(
      `agent-${i % AGENTS}`,
      `l-${i}`,
      `s-${i % 500}`,
      `t-${i}`,
      "claude",
      "claude-opus-5-5",
      `skill-${i % 20}`,
      900,
      null,
      at,
    );
  }
  db.exec("COMMIT");
}

async function buildWorker(): Promise<string> {
  const outfile = join(OUT, "usage-report-worker.cjs");
  await build({
    entryPoints: [join(ROOT, "src/backend/database/usage-report-worker.ts")],
    bundle: true,
    platform: "node",
    format: "cjs",
    outfile,
    logLevel: "silent",
  });
  return outfile;
}

async function timeWorker(
  source: { databasePath: string; workerPath: string },
  input: HostAnalyticsInput,
): Promise<{ result: unknown; ms: number; longestGapMs: number }> {
  let last = performance.now();
  let longestGapMs = 0;
  const ticker = setInterval(() => {
    const now = performance.now();
    longestGapMs = Math.max(longestGapMs, now - last);
    last = now;
  }, TICK_MS);
  const started = performance.now();
  try {
    const result = await Effect.runPromise(readUsageReportInWorker(source, input));
    return { result, ms: performance.now() - started, longestGapMs };
  } finally {
    clearInterval(ticker);
  }
}

async function main(): Promise<void> {
  mkdirSync(OUT, { recursive: true });
  const root = await mkdtemp(join(tmpdir(), "openbot-usage-report-worker-"));
  const database = new OpenBotDatabase(join(root, "profile"));
  try {
    await runCauseEffect(database.initialize());
    seed(database);
    const source = { databasePath: database.path, workerPath: await buildWorker() };
    const month: HostAnalyticsInput = { startDate: day(-29), endDate: day(0), timeZone: "Europe/Warsaw" };
    const inputs: Array<[string, HostAnalyticsInput]> = [
      ...TIME_ZONES.map((timeZone): [string, HostAnalyticsInput] => [
        `30 days ${timeZone}`,
        { startDate: day(-29), endDate: day(0), timeZone },
      ]),
      ["one agent", { startDate: day(-29), endDate: day(0), timeZone: "Europe/Warsaw", agentId: "agent-5" }],
      ["365 days", { startDate: day(-364), endDate: day(0), timeZone: "Europe/Warsaw" }],
    ];
    for (const [name, input] of inputs) {
      const mainStarted = performance.now();
      const onMain = database.usage.readHost(input);
      const mainMs = performance.now() - mainStarted;
      const inWorker = await timeWorker(source, input);
      assert.deepEqual(inWorker.result, onMain, `${name}: worker report differs from the main-thread report`);
      assert.ok(onMain.totals.processedTokens > 0, `${name}: the report has no usage`);
      report.runs.push({
        name,
        mainMs: Math.round(mainMs),
        workerMs: Math.round(inWorker.ms),
        longestMainGapDuringWorkerMs: Math.round(inWorker.longestGapMs),
      });
    }
    report.checks.push("worker report equals the main-thread report for each range, time zone and agent filter");

    const heavy = report.runs.find((run) => run.name === "365 days");
    assert.ok(heavy, "365 days run is missing");
    assert.ok(
      heavy.longestMainGapDuringWorkerMs < heavy.mainMs,
      `main thread stopped for ${heavy.longestMainGapDuringWorkerMs} ms while the worker ran; the main-thread report takes ${heavy.mainMs} ms`,
    );
    report.checks.push("main thread keeps running timers while the worker reads the report");

    const beforeWrite = database.usage.readHost(month);
    const now = new Date().toISOString();
    database.connection.exec("BEGIN IMMEDIATE");
    database.connection
      .prepare("INSERT INTO agent_usage_records VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)")
      .run(
        "agent-1",
        "r-open",
        "s-open",
        "t-open",
        "claude",
        "claude-opus-5-5",
        now,
        JSON.stringify({ uncachedInput: 1, cachedInput: 0, cacheCreation: 0, output: 1 }),
        0.01,
        "list",
        now,
      );
    const duringWrite = await timeWorker(source, month);
    database.connection.exec("COMMIT");
    assert.deepEqual(duringWrite.result, beforeWrite, "worker must read the last committed data");
    assert.notDeepEqual(database.usage.readHost(month).totals, beforeWrite.totals);
    report.checks.push("worker reads committed data while the main connection holds a write transaction");

    const failed = await Effect.runPromise(
      Effect.result(readUsageReportInWorker({ ...source, workerPath: join(OUT, "missing-worker.cjs") }, month)),
    );
    assert.equal(failed._tag, "Failure", "a missing worker file must fail so the caller reads on the main thread");
    report.checks.push("a missing worker file fails, so the caller falls back to the main thread");

    report.passed = true;
  } finally {
    database.close();
    await rm(root, { recursive: true, force: true });
    writeFileSync(join(OUT, "report.json"), `${JSON.stringify(report, null, 2)}\n`);
  }
}

await main();
process.stdout.write(`${JSON.stringify(report, null, 2)}\nReport: ${join(OUT, "report.json")}\n`);
