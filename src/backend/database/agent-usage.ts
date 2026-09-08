import { createHash } from "node:crypto";
import type { DatabaseSync } from "node:sqlite";
import {
  type AgentAnalytics,
  type AgentAnalyticsInput,
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
    return { ...this.readHost(parseAgentAnalyticsInput(raw)), agentId: raw.agentId };
  }

  readHost(raw: HostAnalyticsInput): HostAnalytics {
    const input = parseHostAnalyticsInput(raw);
    const records = databaseRows(
      this.#core.connection
        .prepare(
          "SELECT * FROM agent_usage_records WHERE (? IS NULL OR agent_id = ?) AND occurred_at >= ? AND occurred_at < ?",
        )
        .all(
          input.agentId ?? null,
          input.agentId ?? null,
          new Date(Date.parse(input.startDate) - 86400000).toISOString(),
          new Date(Date.parse(input.endDate) + 2 * 86400000).toISOString(),
        ),
    );
    const activity = databaseRows(
      this.#core.connection
        .prepare(
          "SELECT * FROM agent_usage_activity WHERE (? IS NULL OR agent_id = ?) AND occurred_at >= ? AND occurred_at < ?",
        )
        .all(
          input.agentId ?? null,
          input.agentId ?? null,
          new Date(Date.parse(input.startDate) - 86400000).toISOString(),
          new Date(Date.parse(input.endDate) + 2 * 86400000).toISOString(),
        ),
    );
    const totals = bucket();
    const days = new Map<string, Bucket>();
    for (
      let date = new Date(input.startDate);
      date.getTime() <= Date.parse(input.endDate);
      date.setUTCDate(date.getUTCDate() + 1)
    )
      days.set(date.toISOString().slice(0, 10), bucket());
    const models = new Map<string, { provider: string; model: string; bucket: Bucket }>();
    let updatedAt: string | null = null;
    const targets = (row: DynamicRecord): Bucket[] => {
      const occurred = requiredStringColumn(row, "occurred_at");
      const day = days.get(analyticsDate(new Date(occurred), input.timeZone));
      if (!day) return [];
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
      return [totals, day, entry.bucket];
    };
    for (const row of records) {
      const tokens = decodeUsageTokens(JSON.parse(requiredStringColumn(row, "tokens_json")));
      const turn = JSON.stringify([row.agent_id, row.provider, row.session_id, row.turn_id]);
      for (const target of targets(row)) {
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
    }
    for (const row of activity) {
      for (const target of targets(row)) {
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
