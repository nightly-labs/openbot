import type { AnalyticsProviderDay, AnalyticsTotals, HostAnalytics, HostAnalyticsInput } from "@openbot/contracts/ipc";
import {
  type AgentAnalytics,
  type AgentAnalyticsInput,
  type AgentSummary,
  emptyAnalyticsTotals,
} from "@openbot/contracts/ipc";

// The weight separates the agents from each other: without it every mock agent draws the
// same curve, and the per-agent table previews as identical rows with equal shares.
export function mockAgentAnalytics(
  input: AgentAnalyticsInput,
  agent: Pick<AgentSummary, "id" | "model" | "provider">,
  weight = 1,
): AgentAnalytics {
  const daily = [];
  for (
    let date = new Date(input.startDate);
    date.getTime() <= Date.parse(input.endDate);
    date.setUTCDate(date.getUTCDate() + 1)
  ) {
    const scale = (date.getUTCDate() % 7) + 1;
    daily.push({
      ...emptyAnalyticsTotals(),
      date: date.toISOString().slice(0, 10),
      sessions: 1,
      userMessages: scale,
      assistantMessages: scale,
      turns: scale,
      uncachedInput: scale * weight * 5000,
      cachedInput: scale * weight * 15000,
      cacheCreation: 0,
      output: scale * weight * 1000,
      processedTokens: scale * weight * 21000,
      estimatedCostUsd: scale * weight * 0.025,
    });
  }
  const totals = emptyAnalyticsTotals();
  for (const day of daily) {
    totals.userMessages += day.userMessages;
    totals.assistantMessages += day.assistantMessages;
    totals.turns += day.turns;
    totals.processedTokens += day.processedTokens;
    totals.uncachedInput = (totals.uncachedInput ?? 0) + day.uncachedInput;
    totals.cachedInput = (totals.cachedInput ?? 0) + day.cachedInput;
    totals.output = (totals.output ?? 0) + day.output;
    totals.estimatedCostUsd = (totals.estimatedCostUsd ?? 0) + day.estimatedCostUsd;
  }
  totals.sessions = 1;
  totals.cacheCreation = 0;
  return {
    ...input,
    agentId: agent.id,
    collectionStartedAt: `${input.startDate}T00:00:00Z`,
    updatedAt: new Date().toISOString(),
    totals,
    daily,
    models: [{ ...totals, provider: agent.provider, model: agent.model, share: 1 }],
  };
}

export function mockHostAnalytics(
  input: HostAnalyticsInput,
  agents: Pick<AgentSummary, "id" | "model" | "provider">[],
): HostAnalytics {
  const selected = agents.filter((agent) => !input.agentId || agent.id === input.agentId);
  const reports = selected.map((agent, index) =>
    mockAgentAnalytics({ ...input, agentId: agent.id }, agent, 1 + index * 0.5),
  );
  function sum(rows: AnalyticsTotals[]): AnalyticsTotals {
    const total = emptyAnalyticsTotals();
    for (const row of rows) {
      for (const key of ["uncachedInput", "cachedInput", "cacheCreation", "output", "estimatedCostUsd"] as const)
        if (row[key] !== null) total[key] = (total[key] ?? 0) + row[key];
      for (const key of [
        "processedTokens",
        "sessions",
        "userMessages",
        "assistantMessages",
        "turns",
        "missingUsageTurns",
        "unpricedRecords",
        "incompleteRecords",
      ] as const)
        total[key] += row[key];
    }
    return total;
  }
  const totals = sum(reports.map((report) => report.totals));
  // Each mock report covers one provider, and two agents can share one, so the grid is the
  // reports' daily rows folded together by [date, provider] - the same shape and order the
  // read path produces.
  const providerDays = new Map<string, AnalyticsProviderDay>();
  for (const [index, report] of reports.entries()) {
    const provider = selected[index]?.provider ?? "";
    for (const day of report.daily) {
      const key = JSON.stringify([day.date, provider]);
      const cell = providerDays.get(key) ?? { date: day.date, provider, processedTokens: 0, estimatedCostUsd: null };
      cell.processedTokens += day.processedTokens;
      if (day.estimatedCostUsd !== null) cell.estimatedCostUsd = (cell.estimatedCostUsd ?? 0) + day.estimatedCostUsd;
      providerDays.set(key, cell);
    }
  }
  const models = new Map<string, { provider: string; model: string; rows: AnalyticsTotals[] }>();
  for (const report of reports)
    for (const model of report.models) {
      const key = JSON.stringify([model.provider, model.model]);
      const entry = models.get(key) ?? { provider: model.provider, model: model.model, rows: [] };
      entry.rows.push(model);
      models.set(key, entry);
    }
  return {
    ...input,
    collectionStartedAt: `${input.startDate}T00:00:00Z`,
    updatedAt: new Date().toISOString(),
    totals,
    daily: (reports[0]?.daily ?? []).map((day, index) => ({
      ...sum(reports.flatMap((report) => report.daily[index] ?? [])),
      date: day.date,
    })),
    models: [...models.values()].map((entry) => {
      const values = sum(entry.rows);
      return {
        ...values,
        provider: entry.provider,
        model: entry.model,
        share: totals.processedTokens ? values.processedTokens / totals.processedTokens : 0,
      };
    }),
    agents: reports
      .map((report) => ({
        ...report.totals,
        agentId: report.agentId,
        share: totals.processedTokens ? report.totals.processedTokens / totals.processedTokens : 0,
      }))
      .sort((a, b) => b.processedTokens - a.processedTokens || a.agentId.localeCompare(b.agentId)),
    providerDaily: [...providerDays.values()].sort(
      (a, b) => a.date.localeCompare(b.date) || a.provider.localeCompare(b.provider),
    ),
  };
}
