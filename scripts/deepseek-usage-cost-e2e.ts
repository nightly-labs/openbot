import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { collectProviderUsage } from "../src/backend/agent/usage-collection";
import { runCauseEffect } from "../src/backend/effect-boundary";
import { OpenBotDatabase } from "../src/backend/openbot-database";

const OUT = resolve(import.meta.dirname, "../.openbot-build/deepseek-usage-cost-e2e");
const PRICE_PAGE = "https://api-docs.deepseek.com/quick_start/pricing";
const PEAK_RATES: Readonly<Record<string, { input: number; cached: number; output: number }>> = {
  "deepseek-flash": { input: 0.3, cached: 0.006, output: 1.2 },
  "deepseek-v4-flash": { input: 0.3, cached: 0.006, output: 1.2 },
  "deepseek-v4-pro": { input: 1.32, cached: 0.044, output: 3.96 },
};
const SENT = { input: 100_000, cached: 20_000, output: 5_000 };
const PI_COST = 0.0425;

interface Case {
  name: string;
  model: string;
  occurredAt: string;
  period: "peak" | "off-peak" | null;
  session?: string;
  step?: number;
  piTotal?: number;
  piDelta?: number;
}

interface CaseReport extends Case {
  expectedCost: number;
  cost: number | null;
  basis: string | null;
  passed: boolean;
}

const CASES: readonly Case[] = [
  {
    name: "reported Thursday evening turn",
    model: "deepseek-flash",
    occurredAt: "2026-11-26T19:01:00.000Z",
    period: "off-peak",
  },
  { name: "weekday morning peak", model: "deepseek-flash", occurredAt: "2026-11-26T02:30:00.000Z", period: "peak" },
  { name: "first peak minute", model: "deepseek-flash", occurredAt: "2026-11-26T01:00:00.000Z", period: "peak" },
  { name: "last peak second", model: "deepseek-flash", occurredAt: "2026-11-26T03:59:59.999Z", period: "peak" },
  {
    name: "gap between peak windows",
    model: "deepseek-flash",
    occurredAt: "2026-11-26T04:00:00.000Z",
    period: "off-peak",
  },
  { name: "second peak window", model: "deepseek-v4-pro", occurredAt: "2026-11-26T06:00:00.000Z", period: "peak" },
  {
    name: "end of second peak window",
    model: "deepseek-v4-pro",
    occurredAt: "2026-11-26T10:00:00.000Z",
    period: "off-peak",
  },
  {
    name: "Saturday at a weekday peak hour",
    model: "deepseek-v4-pro",
    occurredAt: "2026-11-28T07:00:00.000Z",
    period: "off-peak",
  },
  {
    name: "Sunday at a weekday peak hour",
    model: "deepseek-flash",
    occurredAt: "2026-11-29T02:00:00.000Z",
    period: "off-peak",
  },
  { name: "retired Flash name", model: "deepseek-v4-flash", occurredAt: "2026-11-30T08:00:00.000Z", period: "peak" },
  {
    name: "model with no OpenBot price keeps the Pi cost",
    model: "deepseek-next",
    occurredAt: "2026-11-26T19:01:00.000Z",
    period: null,
  },
  {
    name: "mixed session, priced turn",
    model: "deepseek-flash",
    occurredAt: "2026-11-26T20:00:00.000Z",
    period: "off-peak",
    session: "mixed",
    step: 1,
    piTotal: 0.03,
  },
  {
    name: "mixed session, unpriced model gets only its own Pi cost",
    model: "deepseek-next",
    occurredAt: "2026-11-26T20:10:00.000Z",
    period: null,
    session: "mixed",
    step: 2,
    piTotal: 0.05,
    piDelta: 0.02,
  },
  {
    name: "mixed session, priced turn again",
    model: "deepseek-flash",
    occurredAt: "2026-11-26T20:20:00.000Z",
    period: "off-peak",
    session: "mixed",
    step: 3,
    piTotal: 0.08,
  },
];

function expectedCost(item: Case): number {
  if (item.period === null) return item.piDelta ?? PI_COST;
  const peak = PEAK_RATES[item.model];
  assert.ok(peak, `${item.name}: no published rate`);
  const part = item.period === "peak" ? 1 : 0.5;
  return (
    (((SENT.input - SENT.cached) * peak.input + SENT.cached * peak.cached + SENT.output * peak.output) * part) /
    1_000_000
  );
}

const report: { passed: boolean; pricePage: string; cases: CaseReport[]; failure?: string } = {
  passed: false,
  pricePage: PRICE_PAGE,
  cases: [],
};
const root = await mkdtemp(join(tmpdir(), "openbot-deepseek-usage-cost-e2e-"));
let database: OpenBotDatabase | undefined;
let reader: DatabaseSync | undefined;

try {
  database = new OpenBotDatabase(join(root, "profile"));
  await runCauseEffect(database.initialize());
  const records = new DatabaseSync(database.path);
  reader = records;
  for (const [index, item] of CASES.entries()) {
    const agent = { id: "agent-e2e", model: item.model };
    const session = {
      id: item.session ?? `session-${index + 1}`,
      provider: "deepseek" as const,
      createdAt: new Date().toISOString(),
    };
    const step = item.step ?? 1;
    const turnId = `turn-${index + 1}`;
    collectProviderUsage(database.usage, agent, session, "turn/started", { turn: { id: turnId } });
    records
      .prepare("UPDATE agent_usage_activity SET occurred_at = ? WHERE agent_id = ? AND activity_id = ?")
      .run(item.occurredAt, agent.id, `turn:${session.id}:${turnId}`);
    collectProviderUsage(database.usage, agent, session, "openbot/usage", {
      threadId: "thread-e2e",
      turnId,
      usage: {
        inputTokens: SENT.input * step,
        cachedReadTokens: SENT.cached * step,
        cachedWriteTokens: 0,
        outputTokens: SENT.output * step,
      },
      cost: item.piTotal ?? PI_COST,
    });
    const row = records
      .prepare(
        "SELECT estimated_cost_usd AS cost, rate_basis AS basis, occurred_at AS occurredAt FROM agent_usage_records WHERE session_id = ? AND turn_id = ?",
      )
      .get(session.id, turnId);
    assert.ok(row, `${item.name}: no usage record`);
    const cost = typeof row.cost === "number" ? row.cost : null;
    const basis = typeof row.basis === "string" ? row.basis : null;
    const entry: CaseReport = { ...item, expectedCost: expectedCost(item), cost, basis, passed: false };
    report.cases.push(entry);
    assert.equal(row.occurredAt, item.occurredAt, `${item.name}: the record keeps the turn time`);
    assert.ok(
      cost !== null && Math.abs(cost - entry.expectedCost) < 1e-12,
      `${item.name}: cost ${cost}, expected ${entry.expectedCost}`,
    );
    if (item.period === null) {
      assert.match(basis ?? "", /^Pi session cost report/u, `${item.name}: the basis names Pi's report`);
    } else {
      const text = basis ?? "";
      assert.ok(text.includes(`"period":"${item.period}"`), `${item.name}: the basis names the period`);
      assert.ok(text.includes(`"source":"${PRICE_PAGE}"`), `${item.name}: the basis names the price page`);
    }
    entry.passed = true;
  }
  report.passed = true;
} catch (error) {
  report.failure = error instanceof Error ? (error.stack ?? error.message) : String(error);
} finally {
  reader?.close();
  database?.close();
  await mkdir(OUT, { recursive: true });
  await writeFile(join(OUT, "report.json"), `${JSON.stringify(report, null, 2)}\n`);
  await rm(root, { recursive: true, force: true });
  process.stdout.write(`${report.passed ? "PASS" : "FAIL"} ${join(OUT, "report.json")}\n`);
  if (report.failure) process.stdout.write(`${report.failure}\n`);
  process.exitCode = report.passed ? 0 : 1;
}
