import { createHash } from "node:crypto";
import type { DatabaseSync } from "node:sqlite";
import { KEY_ONLY_PROVIDERS } from "@openbot/contracts/agent-providers";
import {
  type AgentAnalytics,
  type AgentAnalyticsInput,
  type AnalyticsProviderDay,
  type AnalyticsSkill,
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
import { databaseRow, databaseRows, optionalNumberColumn, requiredStringColumn } from "./database-rows";

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
const TOKEN_KEYS = ["uncachedInput", "cachedInput", "cacheCreation", "output"] as const;

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

  readTurnTotals(agentId: string, turnId: string, since: string): { tokens: number; costUsd: number | null } | null {
    const rows = databaseRows(
      this.#core.connection
        .prepare(
          "SELECT tokens_json, estimated_cost_usd FROM agent_usage_records WHERE agent_id = ? AND occurred_at >= ? AND turn_id = ?",
        )
        .all(agentId, since, turnId),
    );
    if (rows.length === 0) return null;
    let tokens = 0;
    let costUsd: number | null = 0;
    for (const row of rows) {
      const counts = decodeUsageTokens(JSON.parse(requiredStringColumn(row, "tokens_json")));
      for (const key of TOKEN_KEYS) tokens += counts[key] ?? 0;
      const cost = optionalNumberColumn(row, "estimated_cost_usd");
      costUsd = costUsd === null || cost === null ? null : costUsd + cost;
    }
    return { tokens, costUsd };
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
    const input = parseHostAnalyticsInput(raw);
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
      const agentId = requiredStringColumn(row, "agent_id");
      let agentEntry = agents.get(agentId);
      if (!agentEntry) {
        agentEntry = bucket();
        agents.set(agentId, agentEntry);
      }
      const cellKey = JSON.stringify([date, provider]);
      let cell = providerDays.get(cellKey);
      if (!cell) {
        cell = { date, provider, processedTokens: 0, cachedInput: null, estimatedCostUsd: null };
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
      const cell = scope.cell;
      if (cell) {
        for (const key of TOKEN_KEYS) if (tokens[key] !== null) cell.processedTokens += tokens[key];
        if (tokens.cachedInput !== null) cell.cachedInput = (cell.cachedInput ?? 0) + tokens.cachedInput;
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
    const skills = new Map<string, { row: AnalyticsSkill; agents: Set<string> }>();
    let skillTokens = 0;
    for (const row of readRange("agent_usage_skill_loads")) {
      const occurred = requiredStringColumn(row, "occurred_at");
      if (!days.has(analyticsDate(new Date(occurred), input.timeZone))) continue;
      const name = requiredStringColumn(row, "skill");
      let entry = skills.get(name);
      if (!entry) {
        entry = {
          row: { skill: name, loads: 0, tokens: 0, estimatedCostUsd: null, agents: 0, share: 0 },
          agents: new Set(),
        };
        skills.set(name, entry);
      }
      entry.row.loads++;
      const tokens = optionalNumberColumn(row, "tokens") ?? 0;
      entry.row.tokens += tokens;
      skillTokens += tokens;
      const cost = optionalNumberColumn(row, "estimated_cost_usd");
      if (cost !== null) entry.row.estimatedCostUsd = (entry.row.estimatedCostUsd ?? 0) + cost;
      entry.agents.add(requiredStringColumn(row, "agent_id"));
    }
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
        .sort((a, b) => b.processedTokens - a.processedTokens || a.agentId.localeCompare(b.agentId)),
      providerDaily: [...providerDays.values()].sort(
        (a, b) => a.date.localeCompare(b.date) || a.provider.localeCompare(b.provider),
      ),
      skills: [...skills.values()]
        .map(({ row, agents: loadedBy }) => ({
          ...row,
          agents: loadedBy.size,
          share: skillTokens ? row.tokens / skillTokens : 0,
        }))
        .sort((a, b) => b.tokens - a.tokens || b.loads - a.loads || a.skill.localeCompare(b.skill)),
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
