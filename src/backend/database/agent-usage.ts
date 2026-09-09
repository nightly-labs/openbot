import { createHash } from "node:crypto";
import type { DatabaseSync } from "node:sqlite";
import {
  type AgentAnalytics,
  type AgentAnalyticsInput,
  type AnalyticsProviderDay,
  type AnalyticsTotals,
  analyticsDate,
  type ConversationMessage,
  decodeUsageTokens,
  emptyAnalyticsTotals,
  type HostAnalytics,
  type HostAnalyticsInput,
  parseAgentAnalyticsInput,
  parseHostAnalyticsInput,
  type UsageTokens,
} from "@openbot/contracts/ipc";
import type { DynamicRecord } from "@openbot/contracts/runtime-values";
import { estimateUsageCost } from "../agent/usage-pricing";
import type { DatabaseCore } from "./database-core";
import { databaseRow, databaseRows, requiredStringColumn } from "./database-rows";

export interface UsageSample {
  agentId: string;
  sessionId: string;
  turnId: string;
  provider: string;
  model: string;
  counterId: string;
  tokens: UsageTokens;
  baseline: boolean;
  reportedCost?: number | null;
  occurredAt?: string;
  pricingInputTokens?: number | null;
}
const TOKEN_KEYS = ["uncachedInput", "cachedInput", "cacheCreation", "output"] as const;

/** Owns numeric analytics and cumulative checkpoints. Conversation deletion does not erase usage. */
export class AgentUsage {
  readonly #core: DatabaseCore;
  constructor(core: DatabaseCore) {
    this.#core = core;
  }

  collectionStartedAt(): string {
    const row = databaseRow(
      this.#core.connection.prepare("SELECT applied_at FROM schema_migrations WHERE version = 15").get(),
    );
    if (!row) throw new Error("Analytics schema is unavailable.");
    return requiredStringColumn(row, "applied_at");
  }

  reroute(agentId: string, sessionId: string, turnId: string, model: string): void {
    this.#core.connection
      .prepare("UPDATE agent_usage_activity SET model = ? WHERE agent_id = ? AND activity_id = ?")
      .run(model, agentId, `turn:${sessionId}:${turnId}`);
  }

  turnModel(agentId: string, sessionId: string, turnId: string): string | null {
    const row = databaseRow(
      this.#core.connection
        .prepare("SELECT model FROM agent_usage_activity WHERE agent_id = ? AND activity_id = ?")
        .get(agentId, `turn:${sessionId}:${turnId}`),
    );
    return row ? requiredStringColumn(row, "model") : null;
  }

  record(sample: UsageSample): void {
    const tokens = decodeUsageTokens(sample.tokens);
    const digest = createHash("sha256")
      .update(JSON.stringify([sample.counterId, sample.turnId, tokens, sample.reportedCost]))
      .digest("hex");
    this.#core.dispatch(
      `analytics:${sample.agentId}:${digest}`,
      [{ aggregateType: "agent-usage", aggregateId: sample.agentId, eventType: "usage.recorded", payload: { digest } }],
      (db) => {
        const previous = databaseRow(
          db
            .prepare("SELECT tokens_json FROM agent_usage_checkpoints WHERE agent_id = ? AND counter_id = ?")
            .get(sample.agentId, sample.counterId),
        );
        const previousValue = previous ? databaseRow(JSON.parse(requiredStringColumn(previous, "tokens_json"))) : null;
        const previousCost = previousValue?.reportedCost;
        const before = previous ? decodeUsageTokens(JSON.parse(requiredStringColumn(previous, "tokens_json"))) : null;
        const delta: UsageTokens = { ...tokens };
        for (const key of TOKEN_KEYS) {
          const current = tokens[key];
          const prior = before?.[key];
          // Counter resets need an explicit new counter id, never a negative delta treated as fresh usage.
          delta[key] =
            current === null || (before && prior === null)
              ? null
              : prior === undefined
                ? current
                : Math.max(0, current - (prior ?? 0));
          if (prior !== null && prior !== undefined) tokens[key] = current === null ? prior : Math.max(current, prior);
        }
        db.prepare(
          "INSERT INTO agent_usage_checkpoints VALUES (?, ?, ?) ON CONFLICT(agent_id, counter_id) DO UPDATE SET tokens_json = excluded.tokens_json",
        ).run(
          sample.agentId,
          sample.counterId,
          JSON.stringify({
            ...tokens,
            reportedCost:
              sample.reportedCost == null
                ? typeof previousCost === "number"
                  ? previousCost
                  : null
                : Math.max(sample.reportedCost, typeof previousCost === "number" ? previousCost : 0),
          }),
        );
        if ((!before && sample.baseline) || sample.turnId === "baseline") return null;
        const estimate =
          sample.reportedCost !== undefined && sample.reportedCost !== null
            ? {
                cost:
                  before && typeof previousCost !== "number"
                    ? null
                    : Math.max(0, sample.reportedCost - (typeof previousCost === "number" ? previousCost : 0)),
                basis:
                  "Claude SDK list-price estimate; https://platform.claude.com/docs/en/about-claude/pricing; verified 2026-09-07",
              }
            : sample.provider === "claude"
              ? { cost: null, basis: null }
              : estimateUsageCost(
                  sample.provider,
                  sample.model,
                  delta,
                  sample.pricingInputTokens ?? (tokens.uncachedInput ?? 0) + (tokens.cachedInput ?? 0),
                );
        const turn = databaseRow(
          db
            .prepare("SELECT occurred_at FROM agent_usage_activity WHERE agent_id = ? AND activity_id = ?")
            .get(sample.agentId, `turn:${sample.sessionId}:${sample.turnId}`),
        );
        const occurredAt =
          sample.occurredAt ?? (turn ? requiredStringColumn(turn, "occurred_at") : new Date().toISOString());
        db.prepare("INSERT INTO agent_usage_records VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)").run(
          sample.agentId,
          digest,
          sample.sessionId,
          sample.turnId,
          sample.provider,
          sample.model,
          occurredAt,
          JSON.stringify(delta),
          estimate.cost,
          estimate.basis,
          new Date().toISOString(),
        );
        return null;
      },
    );
  }

  startTurn(agentId: string, sessionId: string, turnId: string, provider: string, model: string): void {
    this.#core.connection
      .prepare("INSERT OR IGNORE INTO agent_usage_activity VALUES (?, ?, ?, ?, ?, ?, 'turn', ?)")
      .run(agentId, `turn:${sessionId}:${turnId}`, sessionId, turnId, provider, model, new Date().toISOString());
  }

  read(raw: AgentAnalyticsInput): AgentAnalytics {
    // A spread does not trigger excess-property checking, so the host-only arrays of a
    // single-agent report are dropped by name rather than left for a decoder to strip.
    const { agents: _agents, providerDaily: _providerDaily, ...report } = this.readHost(parseAgentAnalyticsInput(raw));
    return { ...report, agentId: raw.agentId };
  }

  readHost(raw: HostAnalyticsInput): HostAnalytics {
    const input = parseHostAnalyticsInput(raw);
    // One statement per shape rather than one with `(? IS NULL OR agent_id = ?)`. That
    // predicate cannot be answered from an index in either case, so both reads scanned all
    // retained history: a seven-day report cost as much as the whole table, and a report
    // left open repeated it after every turn. Each shape now seeks - the host-wide read on
    // the date-leading index, the agent read on the leading `agent_id` of its own.
    const rangeStart = new Date(Date.parse(input.startDate) - 86400000).toISOString();
    const rangeEnd = new Date(Date.parse(input.endDate) + 2 * 86400000).toISOString();
    const readRange = (table: string): DynamicRecord[] =>
      databaseRows(
        input.agentId
          ? this.#core.connection
              .prepare(`SELECT * FROM ${table} WHERE agent_id = ? AND occurred_at >= ? AND occurred_at < ?`)
              .all(input.agentId, rangeStart, rangeEnd)
          : this.#core.connection
              .prepare(`SELECT * FROM ${table} WHERE occurred_at >= ? AND occurred_at < ?`)
              .all(rangeStart, rangeEnd),
      );
    const records = readRange("agent_usage_records");
    const activity = readRange("agent_usage_activity");
    const totals = bucket();
    const days = new Map<string, Bucket>();
    for (
      let date = new Date(input.startDate);
      date.getTime() <= Date.parse(input.endDate);
      date.setUTCDate(date.getUTCDate() + 1)
    )
      days.set(date.toISOString().slice(0, 10), bucket());
    const models = new Map<string, { provider: string; model: string; bucket: Bucket }>();
    const agents = new Map<string, Bucket>();
    // The chart reads two measures per [date, provider], and a Bucket would allocate three
    // Sets per cell - about 3,300 at the 367-day cap - for fields this row never carries.
    const providerDays = new Map<string, AnalyticsProviderDay>();
    let updatedAt: string | null = null;
    const targets = (row: DynamicRecord): { targets: Bucket[]; cell: AnalyticsProviderDay | null } => {
      const occurred = requiredStringColumn(row, "occurred_at");
      const date = analyticsDate(new Date(occurred), input.timeZone);
      const day = days.get(date);
      if (!day) return { targets: [], cell: null };
      const updated = typeof row.recorded_at === "string" ? row.recorded_at : occurred;
      if (!updatedAt || updated > updatedAt) updatedAt = updated;
      const provider = requiredStringColumn(row, "provider");
      const model = requiredStringColumn(row, "model");
      const key = JSON.stringify([provider, model]);
      let entry = models.get(key);
      if (!entry) {
        entry = { provider, model, bucket: bucket() };
        models.set(key, entry);
      }
      // The bucket is created past the day guard, so an agent whose rows all fall outside
      // the range stays out of the table instead of arriving as a row of zeroes.
      const agentId = requiredStringColumn(row, "agent_id");
      let agentEntry = agents.get(agentId);
      if (!agentEntry) {
        agentEntry = bucket();
        agents.set(agentId, agentEntry);
      }
      const cellKey = JSON.stringify([date, provider]);
      let cell = providerDays.get(cellKey);
      if (!cell) {
        cell = { date, provider, processedTokens: 0, estimatedCostUsd: null };
        providerDays.set(cellKey, cell);
      }
      return { targets: [totals, day, entry.bucket, agentEntry], cell };
    };
    for (const row of records) {
      const tokens = decodeUsageTokens(JSON.parse(requiredStringColumn(row, "tokens_json")));
      const turn = JSON.stringify([row.agent_id, row.provider, row.session_id, row.turn_id]);
      const scope = targets(row);
      for (const target of scope.targets) {
        if (TOKEN_KEYS.some((key) => tokens[key] !== null)) target.usageTurns.add(turn);
        target.sessions.add(JSON.stringify([row.agent_id, row.provider, row.session_id]));
        for (const key of TOKEN_KEYS) {
          if (tokens[key] !== null) {
            target.values[key] = (target.values[key] ?? 0) + tokens[key];
            target.values.processedTokens += tokens[key];
          }
        }
        if (TOKEN_KEYS.some((key) => tokens[key] === null)) target.values.incompleteRecords++;
        if (typeof row.estimated_cost_usd === "number")
          target.values.estimatedCostUsd = (target.values.estimatedCostUsd ?? 0) + row.estimated_cost_usd;
        else target.values.unpricedRecords++;
      }
      // Only this loop feeds the cell: tokens and cost live on agent_usage_records, and the
      // activity rows below carry turn and message counts the cell does not hold.
      const cell = scope.cell;
      if (cell) {
        for (const key of TOKEN_KEYS) if (tokens[key] !== null) cell.processedTokens += tokens[key];
        if (typeof row.estimated_cost_usd === "number")
          cell.estimatedCostUsd = (cell.estimatedCostUsd ?? 0) + row.estimated_cost_usd;
      }
    }
    for (const row of activity) {
      for (const target of targets(row).targets) {
        if (row.kind === "turn") {
          target.turns.add(JSON.stringify([row.agent_id, row.provider, row.session_id, row.turn_id]));
          target.sessions.add(JSON.stringify([row.agent_id, row.provider, row.session_id]));
        } else if (row.kind === "user") target.values.userMessages++;
        else target.values.assistantMessages++;
      }
    }
    const summary = finish(totals);
    return {
      ...input,
      collectionStartedAt: this.collectionStartedAt(),
      updatedAt,
      totals: summary,
      daily: [...days].map(([date, item]) => ({ date, ...finish(item) })),
      models: [...models.values()]
        .map(({ provider, model, bucket: item }) => ({
          provider,
          model,
          ...finish(item),
          share: summary.processedTokens ? item.values.processedTokens / summary.processedTokens : 0,
        }))
        .sort((a, b) => b.processedTokens - a.processedTokens),
      agents: [...agents]
        .map(([agentId, item]) => ({
          agentId,
          ...finish(item),
          share: summary.processedTokens ? item.values.processedTokens / summary.processedTokens : 0,
        }))
        // Agent ids are unique, so the tiebreak makes the order of two equal rows a
        // decision rather than a consequence of the unordered SELECT above.
        .sort((a, b) => b.processedTokens - a.processedTokens || a.agentId.localeCompare(b.agentId)),
      // daily leans on the insertion order of a map seeded date by date; this map is built
      // lazily from an ORDER BY-less SELECT, so the order is sorted rather than inherited.
      providerDaily: [...providerDays.values()].sort(
        (a, b) => a.date.localeCompare(b.date) || a.provider.localeCompare(b.provider),
      ),
    };
  }
}
interface Bucket {
  values: AnalyticsTotals;
  sessions: Set<string>;
  turns: Set<string>;
  usageTurns: Set<string>;
}
function bucket(): Bucket {
  return { values: emptyAnalyticsTotals(), sessions: new Set(), turns: new Set(), usageTurns: new Set() };
}
function finish(item: Bucket): AnalyticsTotals {
  return {
    ...item.values,
    sessions: item.sessions.size,
    turns: item.turns.size,
    missingUsageTurns: [...item.turns].filter((turn) => !item.usageTurns.has(turn)).length,
  };
}

/** Called inside the conversation writer's transaction; only message identity and counts survive. */
export function recordUsageMessage(
  db: DatabaseSync,
  agentId: string,
  message: ConversationMessage,
  provider: string,
  model: string,
): void {
  if (message.author !== "user" && message.author !== "assistant") return;
  if (
    message.author === "assistant" &&
    (message.status !== "completed" ||
      (message.itemType && message.itemType !== "agentMessage" && message.itemType !== "final_answer"))
  )
    return;
  db.prepare(`INSERT OR IGNORE INTO agent_usage_activity
    SELECT ?, ?, '', ?, ?, ?, ?, ? WHERE ? >= (SELECT applied_at FROM schema_migrations WHERE version = 15)`).run(
    agentId,
    `message:${message.id}`,
    message.turnId ?? "",
    provider,
    model,
    message.author,
    message.createdAt,
    message.createdAt,
  );
}
