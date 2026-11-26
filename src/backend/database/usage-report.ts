import type { DatabaseSync } from "node:sqlite";
import {
  type AnalyticsProviderDay,
  type AnalyticsSkill,
  type AnalyticsTotals,
  analyticsDate,
  decodeUsageTokens,
  emptyAnalyticsTotals,
  type HostAnalytics,
  type HostAnalyticsInput,
  parseHostAnalyticsInput,
  type UsageTokens,
} from "@openbot/contracts/ipc";
import type { DynamicRecord } from "@openbot/contracts/runtime-values";
import { estimateUsageCost } from "../agent/usage-pricing";
import { databaseRow, databaseRows, optionalNumberColumn, requiredStringColumn } from "./database-rows";

export const TOKEN_KEYS = ["uncachedInput", "cachedInput", "cacheCreation", "output"] as const;
const TIME_ZONE_OFFSET_STEP_MS = 15 * 60 * 1000;

export function usageCollectionStartedAt(connection: DatabaseSync): string {
  const row = databaseRow(connection.prepare("SELECT applied_at FROM schema_migrations WHERE version = 15").get());
  if (!row) throw new Error("Analytics schema is unavailable.");
  return requiredStringColumn(row, "applied_at");
}

export function readUsageReport(connection: DatabaseSync, raw: HostAnalyticsInput): HostAnalytics {
  const input = parseHostAnalyticsInput(raw);
  const rangeStart = new Date(Date.parse(input.startDate) - 86400000).toISOString();
  const rangeEnd = new Date(Date.parse(input.endDate) + 2 * 86400000).toISOString();
  const readRange = (table: string): DynamicRecord[] =>
    databaseRows(
      input.agentId
        ? connection
            .prepare(`SELECT * FROM ${table} WHERE agent_id = ? AND occurred_at >= ? AND occurred_at < ?`)
            .all(input.agentId, rangeStart, rangeEnd)
        : connection
            .prepare(`SELECT * FROM ${table} WHERE occurred_at >= ? AND occurred_at < ?`)
            .all(rangeStart, rangeEnd),
    );
  const dateOf = analyticsDates(input.timeZone);
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
    const date = dateOf(occurred);
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
    const scope = targets(row);
    if (scope.targets.length === 0) continue;
    const turn = JSON.stringify([row.agent_id, row.provider, row.session_id, row.turn_id]);
    const session = JSON.stringify([row.agent_id, row.provider, row.session_id]);
    const cost = recordCost(row, tokens);
    const reported = TOKEN_KEYS.some((key) => tokens[key] !== null);
    const incomplete = TOKEN_KEYS.some((key) => tokens[key] === null);
    for (const target of scope.targets) {
      if (reported) target.usageTurns.add(turn);
      target.sessions.add(session);
      for (const key of TOKEN_KEYS) {
        if (tokens[key] !== null) {
          target.values[key] = (target.values[key] ?? 0) + tokens[key];
          target.values.processedTokens += tokens[key];
        }
      }
      if (incomplete) target.values.incompleteRecords++;
      if (cost !== null) target.values.estimatedCostUsd = (target.values.estimatedCostUsd ?? 0) + cost;
      else target.values.unpricedRecords++;
    }
    const cell = scope.cell;
    if (cell) {
      for (const key of TOKEN_KEYS) if (tokens[key] !== null) cell.processedTokens += tokens[key];
      if (tokens.cachedInput !== null) cell.cachedInput = (cell.cachedInput ?? 0) + tokens.cachedInput;
      if (cost !== null) cell.estimatedCostUsd = (cell.estimatedCostUsd ?? 0) + cost;
    }
  }
  for (const row of activity) {
    const scope = targets(row).targets;
    if (row.kind === "turn") {
      const turn = JSON.stringify([row.agent_id, row.provider, row.session_id, row.turn_id]);
      const session = JSON.stringify([row.agent_id, row.provider, row.session_id]);
      for (const target of scope) {
        target.turns.add(turn);
        target.sessions.add(session);
      }
    } else if (row.kind === "user") for (const target of scope) target.values.userMessages++;
    else for (const target of scope) target.values.assistantMessages++;
  }
  const summary = finish(totals);
  const skills = new Map<string, { row: AnalyticsSkill; agents: Set<string> }>();
  let skillTokens = 0;
  for (const row of readRange("agent_usage_skill_loads")) {
    const occurred = requiredStringColumn(row, "occurred_at");
    if (!days.has(dateOf(occurred))) continue;
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
    const loadTokens = optionalNumberColumn(row, "tokens");
    const tokens = loadTokens ?? 0;
    entry.row.tokens += tokens;
    skillTokens += tokens;
    const cost =
      loadTokens === null
        ? null
        : recordCost(row, { uncachedInput: loadTokens, cachedInput: 0, cacheCreation: 0, output: 0 });
    if (cost !== null) entry.row.estimatedCostUsd = (entry.row.estimatedCostUsd ?? 0) + cost;
    entry.agents.add(requiredStringColumn(row, "agent_id"));
  }
  return {
    ...input,
    collectionStartedAt: usageCollectionStartedAt(connection),
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
function analyticsDates(timeZone: string): (occurred: string) => string {
  const dates = new Map<number, string>();
  return (occurred) => {
    const time = Date.parse(occurred);
    const slot = Math.floor(time / TIME_ZONE_OFFSET_STEP_MS);
    const known = dates.get(slot);
    if (known !== undefined) return known;
    const date = analyticsDate(new Date(time), timeZone);
    dates.set(slot, date);
    return date;
  };
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
export function recordCost(row: DynamicRecord, tokens: UsageTokens): number | null {
  return (
    optionalNumberColumn(row, "estimated_cost_usd") ??
    estimateUsageCost(
      requiredStringColumn(row, "provider"),
      requiredStringColumn(row, "model"),
      tokens,
      null,
      null,
      requiredStringColumn(row, "occurred_at"),
    ).cost
  );
}
function finish(item: Bucket): AnalyticsTotals {
  return {
    ...item.values,
    sessions: item.sessions.size,
    turns: item.turns.size,
    missingUsageTurns: [...item.turns].filter((turn) => !item.usageTurns.has(turn)).length,
  };
}
