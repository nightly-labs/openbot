import { createHash } from "node:crypto";
import type { DatabaseSync } from "node:sqlite";
import { KEY_ONLY_PROVIDERS } from "@openbot/contracts/agent-providers";
import {
  type AgentAnalytics,
  type AgentAnalyticsInput,
  type ConversationMessage,
  decodeUsageTokens,
  type HostAnalytics,
  type HostAnalyticsInput,
  parseAgentAnalyticsInput,
  type UsageTokens,
} from "@openbot/contracts/ipc";
import { estimateUsageCost } from "../agent/usage-pricing";
import type { DatabaseCore } from "./database-core";
import { databaseRow, databaseRows, requiredStringColumn } from "./database-rows";
import { readUsageReport, recordCost, TOKEN_KEYS, usageCollectionStartedAt } from "./usage-report";

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
  lastRequestInputTokens?: number | null;
  smallestRequestInputTokens?: number | null;
  previousTokens?: UsageTokens | null;
  costCounterId?: string;
  zeroCostUnpriced?: boolean;
}

export interface SkillLoadSample {
  agentId: string;
  sessionId: string;
  turnId: string;
  itemId: string;
  provider: string;
  model: string;
  skill: string;
  tokens: number | null;
  occurredAt: string;
}

export interface TurnModelUsage {
  provider: string;
  model: string;
  tokens: UsageTokens;
}

export class AgentUsage {
  readonly #core: DatabaseCore;
  constructor(core: DatabaseCore) {
    this.#core = core;
  }

  collectionStartedAt(): string {
    return usageCollectionStartedAt(this.#core.connection);
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
        const costCheckpoint = sample.costCounterId
          ? databaseRow(
              db
                .prepare("SELECT tokens_json FROM agent_usage_checkpoints WHERE agent_id = ? AND counter_id = ?")
                .get(sample.agentId, sample.costCounterId),
            )
          : previous;
        const previousValue = costCheckpoint
          ? databaseRow(JSON.parse(requiredStringColumn(costCheckpoint, "tokens_json")))
          : null;
        const previousCost = previousValue?.reportedCost;
        const reportedCost =
          sample.reportedCost == null
            ? typeof previousCost === "number"
              ? previousCost
              : null
            : Math.max(sample.reportedCost, typeof previousCost === "number" ? previousCost : 0);
        const before = previous
          ? decodeUsageTokens(JSON.parse(requiredStringColumn(previous, "tokens_json")))
          : sample.baseline
            ? null
            : (sample.previousTokens ?? null);
        const delta: UsageTokens = { ...tokens };
        for (const key of TOKEN_KEYS) {
          const current = tokens[key];
          const prior = before?.[key];
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
          JSON.stringify(sample.costCounterId ? tokens : { ...tokens, reportedCost }),
        );
        const costStartUnknown =
          sample.costCounterId && sample.reportedCost != null && typeof previousCost !== "number"
            ? databaseRow(
                db
                  .prepare("SELECT 1 FROM agent_usage_records WHERE agent_id = ? AND session_id = ? LIMIT 1")
                  .get(sample.agentId, sample.sessionId),
              ) !== null
            : false;
        if (sample.costCounterId && sample.reportedCost != null)
          db.prepare(
            "INSERT INTO agent_usage_checkpoints VALUES (?, ?, ?) ON CONFLICT(agent_id, counter_id) DO UPDATE SET tokens_json = excluded.tokens_json",
          ).run(sample.agentId, sample.costCounterId, JSON.stringify({ reportedCost }));
        if ((!before && sample.baseline) || sample.turnId === "baseline") return null;
        const reportedDelta =
          sample.reportedCost === undefined ||
          sample.reportedCost === null ||
          costStartUnknown ||
          (!sample.costCounterId && before && typeof previousCost !== "number")
            ? null
            : Math.max(0, sample.reportedCost - (typeof previousCost === "number" ? previousCost : 0));
        const reported =
          reportedDelta === null || (sample.zeroCostUnpriced && reportedDelta === 0)
            ? null
            : { cost: reportedDelta, basis: reportedCostBasis(sample.provider) };
        const turn = databaseRow(
          db
            .prepare("SELECT occurred_at FROM agent_usage_activity WHERE agent_id = ? AND activity_id = ?")
            .get(sample.agentId, `turn:${sample.sessionId}:${sample.turnId}`),
        );
        const occurredAt =
          sample.occurredAt ?? (turn ? requiredStringColumn(turn, "occurred_at") : new Date().toISOString());
        const estimate =
          reported ??
          estimateUsageCost(
            sample.provider,
            sample.model,
            delta,
            sample.lastRequestInputTokens ?? null,
            sample.smallestRequestInputTokens ?? null,
            occurredAt,
          );
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

  recordSkillLoad(sample: SkillLoadSample): void {
    const cost =
      sample.tokens === null
        ? null
        : estimateUsageCost(
            sample.provider,
            sample.model,
            { uncachedInput: sample.tokens, cachedInput: 0, cacheCreation: 0, output: 0 },
            null,
            null,
            sample.occurredAt,
          ).cost;
    this.#core.connection
      .prepare("INSERT OR IGNORE INTO agent_usage_skill_loads VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)")
      .run(
        sample.agentId,
        JSON.stringify([sample.sessionId, sample.itemId, sample.skill]),
        sample.sessionId,
        sample.turnId,
        sample.provider,
        sample.model,
        sample.skill,
        sample.tokens,
        cost,
        sample.occurredAt,
      );
  }

  startTurn(agentId: string, sessionId: string, turnId: string, provider: string, model: string): void {
    this.#core.connection
      .prepare("INSERT OR IGNORE INTO agent_usage_activity VALUES (?, ?, ?, ?, ?, ?, 'turn', ?)")
      .run(agentId, `turn:${sessionId}:${turnId}`, sessionId, turnId, provider, model, new Date().toISOString());
  }

  readTurn(agentId: string, turnId: string, since: string): TurnModelUsage[] {
    const rows = databaseRows(
      this.#core.connection
        .prepare(
          "SELECT provider, model, tokens_json FROM agent_usage_records WHERE agent_id = ? AND occurred_at >= ? AND turn_id = ?",
        )
        .all(agentId, since, turnId),
    );
    const models = new Map<string, TurnModelUsage>();
    for (const row of rows) {
      const provider = requiredStringColumn(row, "provider");
      const model = requiredStringColumn(row, "model");
      const key = JSON.stringify([provider, model]);
      let entry = models.get(key);
      if (!entry) {
        entry = { provider, model, tokens: { uncachedInput: 0, cachedInput: 0, cacheCreation: 0, output: 0 } };
        models.set(key, entry);
      }
      const tokens = decodeUsageTokens(JSON.parse(requiredStringColumn(row, "tokens_json")));
      for (const key of TOKEN_KEYS) {
        const value = tokens[key];
        const total = entry.tokens[key];
        entry.tokens[key] = value === null || total === null ? null : total + value;
      }
    }
    return [...models.values()];
  }

  readTurnTotals(
    agentId: string,
    turnId: string,
    since: string,
  ): { tokens: number; cachedInput: number; costUsd: number | null } | null {
    const rows = databaseRows(
      this.#core.connection
        .prepare(
          "SELECT provider, model, occurred_at, tokens_json, estimated_cost_usd FROM agent_usage_records WHERE agent_id = ? AND occurred_at >= ? AND turn_id = ?",
        )
        .all(agentId, since, turnId),
    );
    if (rows.length === 0) return null;
    let tokens = 0;
    let cachedInput = 0;
    let costUsd: number | null = 0;
    for (const row of rows) {
      const counts = decodeUsageTokens(JSON.parse(requiredStringColumn(row, "tokens_json")));
      for (const key of TOKEN_KEYS) tokens += counts[key] ?? 0;
      cachedInput += counts.cachedInput ?? 0;
      const cost = recordCost(row, counts);
      costUsd = costUsd === null || cost === null ? null : costUsd + cost;
    }
    return { tokens, cachedInput, costUsd };
  }

  read(raw: AgentAnalyticsInput): AgentAnalytics {
    const {
      agents: _agents,
      providerDaily: _providerDaily,
      skills: _skills,
      ...report
    } = this.readHost(parseAgentAnalyticsInput(raw));
    return { ...report, agentId: raw.agentId };
  }

  readHost(raw: HostAnalyticsInput): HostAnalytics {
    return readUsageReport(this.#core.connection, raw);
  }
}

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

function reportedCostBasis(provider: string) {
  if (provider === "opencode") return "OpenCode session cost report; API-equivalent rates, not subscription charges";
  if (provider === "grok") return "Grok CLI prompt cost report";
  if (provider === "pi" || KEY_ONLY_PROVIDERS.some((id) => id === provider))
    return "Pi session cost report; rates of Pi's model list, not subscription charges";
  if (provider === "acp") return "Custom agent session cost report";
  return "Claude SDK list-price estimate; https://platform.claude.com/docs/en/about-claude/pricing; verified 2026-09-07";
}
