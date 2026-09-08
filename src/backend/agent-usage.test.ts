import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { type AgentAnalyticsInput, parseAgentAnalyticsInput, type UsageTokens } from "@openbot/contracts/ipc";
import { afterEach, describe, expect, it } from "vitest";
import { collectProviderUsage } from "./agent/usage-collection";
import { recordUsageMessage, type UsageSample } from "./database/agent-usage";
import { OpenBotDatabase } from "./openbot-database";
import { migrateOpenBotDatabase } from "./openbot-database-schema";

const roots: string[] = [];
const databases: OpenBotDatabase[] = [];
afterEach(async () => {
  for (const db of databases.splice(0)) db.close();
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});
const range: AgentAnalyticsInput = {
  agentId: "agent-a",
  startDate: "2026-09-01",
  endDate: "2026-09-07",
  timeZone: "UTC",
};
const tokens: UsageTokens = { uncachedInput: 100, cachedInput: 200, cacheCreation: 0, output: 50 };
const sample: UsageSample = {
  agentId: "agent-a",
  sessionId: "session-a",
  turnId: "turn-a",
  provider: "codex",
  model: "gpt-5.6-sol",
  counterId: "counter-a",
  tokens,
  baseline: false,
  occurredAt: "2026-09-02T12:00:00Z",
};
async function database() {
  const root = await mkdtemp(join(tmpdir(), "openbot-usage-"));
  roots.push(root);
  const db = new OpenBotDatabase(root);
  await db.initialize();
  databases.push(db);
  return db;
}

describe("local agent usage", () => {
  it("combines agents without merging sessions that share provider session ids", async () => {
    const db = await database();
    db.usage.record(sample);
    db.usage.record({ ...sample, agentId: "agent-b", model: "unknown-model" });
    db.usage.record({
      ...sample,
      agentId: "agent-c",
      provider: "claude",
      model: "unknown-model",
      tokens: { ...tokens, output: null },
    });
    const all = db.usage.readHost({ startDate: range.startDate, endDate: range.endDate, timeZone: range.timeZone });
    expect(all.agentId).toBeUndefined();
    expect(all.totals.sessions).toBe(3);
    expect(all.totals.processedTokens).toBe(1000);
    expect(all.totals.unpricedRecords).toBe(2);
    expect(all.totals.incompleteRecords).toBe(1);
    expect(all.models.map((model) => [model.provider, model.model, model.share])).toEqual([
      ["codex", "gpt-5.6-sol", 0.35],
      ["codex", "unknown-model", 0.35],
      ["claude", "unknown-model", 0.3],
    ]);
    expect(all.agents.map((agent) => [agent.agentId, agent.processedTokens, agent.share])).toEqual([
      ["agent-a", 350, 0.35],
      ["agent-b", 350, 0.35],
      ["agent-c", 300, 0.3],
    ]);
    expect(db.usage.readHost(range).totals).toEqual(db.usage.read(range).totals);
    const anotherHost = await database();
    expect(anotherHost.usage.readHost(range).totals.sessions).toBe(0);
  });
  // The chart draws one area per provider, so the host report carries a cell per calendar
  // day and provider. No other fixture reads two dates through readHost, which is where
  // the bucketing and the range guard live.
  it("groups the daily provider grid by calendar day and leaves out-of-range rows out", async () => {
    const db = await database();
    db.usage.record(sample);
    db.usage.record({ ...sample, agentId: "agent-c", provider: "claude", counterId: "claude-a" });
    db.usage.record({ ...sample, counterId: "day-three", occurredAt: "2026-09-03T12:00:00Z" });
    db.usage.record({ ...sample, counterId: "old", occurredAt: "2026-08-31T23:59:59Z" });
    const all = db.usage.readHost({ startDate: range.startDate, endDate: range.endDate, timeZone: range.timeZone });
    expect(all.providerDaily.map((cell) => [cell.date, cell.provider, cell.processedTokens])).toEqual([
      ["2026-09-02", "claude", 350],
      ["2026-09-02", "codex", 350],
      ["2026-09-03", "codex", 350],
    ]);
    // The grid is host-only: on an agent-scoped report it would restate one provider.
    expect(db.usage.read(range)).not.toHaveProperty("providerDaily");
  });
  it("normalizes provider usage and counts completed answers without commentary or old messages", async () => {
    const db = await database();
    const now = new Date().toISOString();
    const agent = { id: "agent-a", model: "gpt-5.6-sol" };
    const session = { id: "session-a", provider: "codex" as const, createdAt: now };
    collectProviderUsage(db.usage, agent, session, "turn/started", { turn: { id: "turn-a" } });
    collectProviderUsage(db.usage, agent, session, "thread/tokenUsage/updated", {
      turnId: "turn-a",
      tokenUsage: { total: { inputTokens: 300, cachedInputTokens: 200, outputTokens: 50, reasoningOutputTokens: 20 } },
    });
    collectProviderUsage(db.usage, agent, { ...session, provider: "claude" }, "openbot/usage", {
      turnId: "turn-a",
      counterId: "query-a",
      modelUsage: {
        "claude-sonnet-5": {
          inputTokens: 100,
          cacheReadInputTokens: 200,
          cacheCreationInputTokens: 20,
          outputTokens: 50,
          costUSD: 0.01,
        },
      },
    });
    collectProviderUsage(db.usage, agent, { ...session, provider: "grok" }, "openbot/usage", {
      turnId: "turn-a",
      usage: { inputTokens: 100, outputTokens: 40 },
    });
    for (const message of [
      { id: "user", author: "user" as const, itemType: "userMessage" },
      { id: "answer", author: "assistant" as const, itemType: "agentMessage" },
      { id: "commentary", author: "assistant" as const, itemType: "commentary" },
    ])
      recordUsageMessage(
        db.connection,
        agent.id,
        { ...message, text: "private message", status: "completed", createdAt: now },
        session.provider,
        agent.model,
      );
    recordUsageMessage(
      db.connection,
      agent.id,
      { id: "old", author: "user", text: "old secret", status: "completed", createdAt: "2020-01-01T00:00:00Z" },
      session.provider,
      agent.model,
    );
    const result = db.usage.read({ ...range, startDate: now.slice(0, 10), endDate: now.slice(0, 10) });
    expect(result.totals).toMatchObject({
      processedTokens: 760,
      userMessages: 1,
      assistantMessages: 1,
      incompleteRecords: 1,
    });
    expect(result.models.find((model) => model.provider === "claude")?.estimatedCostUsd).toBe(0.01);
    expect(JSON.stringify(result)).not.toContain("private message");
    expect(JSON.stringify(db.connection.prepare("SELECT * FROM agent_usage_activity").all())).not.toContain(
      "old secret",
    );
  });
  it("preserves counters across restart and counts duplicate and delayed snapshots once", async () => {
    const db = await database();
    db.usage.record(sample);
    db.usage.record(sample);
    db.close();
    await db.initialize();
    db.usage.record({ ...sample, tokens: { ...tokens, uncachedInput: 140, output: 70 } });
    db.usage.record({ ...sample, tokens: { ...tokens, uncachedInput: 120, output: 60 } });
    const result = db.usage.read(range);
    expect(result.totals).toMatchObject({
      processedTokens: 410,
      uncachedInput: 140,
      cachedInput: 200,
      output: 70,
      sessions: 1,
    });
    expect(result.daily.find((day) => day.date === "2026-09-02")?.processedTokens).toBe(410);
    expect(result.totals.estimatedCostUsd).toBeCloseTo(0.00204);
  });

  it("does not import old cumulative usage and starts new query counters from zero", async () => {
    const db = await database();
    db.usage.record({ ...sample, baseline: true });
    expect(db.usage.read(range).totals.processedTokens).toBe(0);
    db.usage.record({ ...sample, turnId: "turn-b", tokens: { ...tokens, output: 80 } });
    expect(db.usage.read(range).totals.processedTokens).toBe(30);
    db.usage.record({
      ...sample,
      turnId: "turn-c",
      counterId: "query-after-restart",
      tokens: { ...tokens, output: 10 },
    });
    expect(db.usage.read(range).totals.processedTokens).toBe(340);
  });

  it("isolates agents, dates, sessions, and models while preserving unknown costs", async () => {
    const db = await database();
    db.usage.record(sample);
    db.usage.record({ ...sample, agentId: "agent-b" });
    db.usage.record({ ...sample, counterId: "old", occurredAt: "2026-08-31T23:59:59Z" });
    db.usage.record({ ...sample, counterId: "future", occurredAt: "2026-09-08T00:00:00Z" });
    db.usage.record({
      ...sample,
      counterId: "other-model",
      sessionId: "session-b",
      model: "unknown-model",
      tokens: { uncachedInput: null, cachedInput: null, cacheCreation: null, output: 50 },
    });
    const result = db.usage.read(range);
    expect(result.totals).toMatchObject({ processedTokens: 400, sessions: 2, unpricedRecords: 1 });
    expect(result.models.map((model) => [model.model, model.processedTokens, model.share])).toEqual([
      ["gpt-5.6-sol", 350, 0.875],
      ["unknown-model", 50, 0.125],
    ]);
    expect(result.models[1]?.estimatedCostUsd).toBeNull();
    const incomplete = {
      ...sample,
      agentId: "agent-c",
      provider: "claude",
      reportedCost: null,
      tokens: { ...tokens, output: null },
    };
    db.usage.record(incomplete);
    db.usage.record({ ...incomplete, tokens, reportedCost: 1 });
    const newlyAvailable = db.usage.read({ ...range, agentId: "agent-c" });
    expect(newlyAvailable.totals.output).toBeNull();
    expect(newlyAvailable.totals.estimatedCostUsd).toBeNull();
    db.usage.record({ ...incomplete, tokens: { ...tokens, output: 60 }, reportedCost: 1.1 });
    const complete = db.usage.read({ ...range, agentId: "agent-c" });
    expect(complete.totals.output).toBe(10);
    expect(complete.totals.estimatedCostUsd).toBeCloseTo(0.1);
    const longContext = { ...sample, agentId: "agent-d", pricingInputTokens: 250_000 };
    db.usage.record(longContext);
    db.usage.record({ ...longContext, tokens: { ...tokens, output: 60 } });
    expect(db.usage.read({ ...range, agentId: "agent-d" }).totals.estimatedCostUsd).toBeNull();
  });

  it("uses local calendar boundaries across daylight saving changes", async () => {
    const db = await database();
    const input = { ...range, startDate: "2026-03-29", endDate: "2026-03-29", timeZone: "Europe/Warsaw" };
    for (const [counterId, occurredAt] of [
      ["before", "2026-03-28T22:59:59Z"],
      ["start", "2026-03-28T23:00:00Z"],
      ["end", "2026-03-29T21:59:59Z"],
      ["after", "2026-03-29T22:00:00Z"],
    ])
      db.usage.record({ ...sample, counterId, occurredAt });
    expect(db.usage.read(input).totals.processedTokens).toBe(700);
    expect(() => parseAgentAnalyticsInput({ ...input, timeZone: "bad-zone" })).toThrow();
    expect(() => parseAgentAnalyticsInput({ ...input, startDate: "2026-02-30" })).toThrow("Invalid analytics date");
  });

  it("keeps usage after conversation clear and removes all analytics on agent deletion", async () => {
    const db = await database();
    db.usage.record(sample);
    db.connection.exec("DELETE FROM projection_thread_messages; DELETE FROM projection_threads");
    expect(db.usage.read(range).totals.processedTokens).toBe(350);
    expect(db.usage.read({ ...range, agentId: "duplicate-agent" }).totals.processedTokens).toBe(0);
    db.hardDeleteAgent("delete-agent-a", "agent-a", null, []);
    expect(db.usage.read(range).totals.processedTokens).toBe(0);
    expect(db.connection.prepare("SELECT count(*) AS count FROM agent_usage_checkpoints").get()).toMatchObject({
      count: 0,
    });
    expect(
      db.connection
        .prepare("SELECT count(*) AS count FROM orchestration_events WHERE aggregate_type = 'agent-usage'")
        .get(),
    ).toMatchObject({ count: 0 });
  });

  it("rolls back a usage write with its checkpoint and permits retry", async () => {
    const db = await database();
    db.connection.exec(
      "CREATE TRIGGER fail_usage BEFORE INSERT ON agent_usage_records BEGIN SELECT RAISE(ABORT, 'usage failure'); END",
    );
    expect(() => db.usage.record(sample)).toThrow("usage failure");
    expect(db.connection.prepare("SELECT count(*) AS count FROM agent_usage_checkpoints").get()).toMatchObject({
      count: 0,
    });
    db.connection.exec("DROP TRIGGER fail_usage");
    db.usage.record(sample);
    expect(db.usage.read(range).totals.processedTokens).toBe(350);
  });

  it("upgrades v14 without touching existing data and rolls back a failed migration", () => {
    const db = new DatabaseSync(":memory:");
    try {
      migrateOpenBotDatabase(db);
      db.exec(
        "DROP TABLE agent_usage_records; DROP TABLE agent_usage_checkpoints; DROP TABLE agent_usage_activity; DELETE FROM schema_migrations WHERE version >= 15; CREATE TABLE preservation(value TEXT); INSERT INTO preservation VALUES ('keep'); CREATE TABLE agent_usage_date (conflict TEXT)",
      );
      // Every later version goes with 15: a history that keeps 16 but drops 15 has a gap,
      // which the schema check rejects before any upgrade runs.
      // The squatted name is the index's, not a table's: the migration creates its tables with
      // IF NOT EXISTS, and SQLite refuses an index whose name a table already holds however the
      // statement is spelled. What is under test is the rollback, not which object collides.
      expect(() => migrateOpenBotDatabase(db)).toThrow("migration to version 15 failed");
      expect(db.prepare("SELECT name FROM sqlite_master WHERE name = 'agent_usage_records'").get()).toBeUndefined();
      expect(db.prepare("SELECT version FROM schema_migrations WHERE version = 15").get()).toBeUndefined();
      db.exec("DROP TABLE agent_usage_date");
      migrateOpenBotDatabase(db);
      expect(db.prepare("SELECT value FROM preservation").get()).toMatchObject({ value: "keep" });
      // A host-wide report constrains the date alone, so it can only seek on an index that
      // leads with `occurred_at`. Without these a report scans all retained history, and
      // the parity check cannot notice: it compares the two build paths to each other.
      expect(
        db
          .prepare("SELECT name FROM sqlite_master WHERE type = 'index' AND name LIKE '%_occurred' ORDER BY name")
          .all(),
      ).toEqual([{ name: "agent_usage_activity_occurred" }, { name: "agent_usage_occurred" }]);
      expect(db.prepare("PRAGMA integrity_check").get()).toMatchObject({ integrity_check: "ok" });
      expect(db.prepare("PRAGMA foreign_key_check").all()).toEqual([]);
    } finally {
      db.close();
    }
  });
});
