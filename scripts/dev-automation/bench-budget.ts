import { isDynamicRecord, isNumber } from "@openbot/contracts/runtime-values";
import type { BenchReport } from "./bench-stats";

export type PerfBudget = Map<string, Map<string, number>>;

export interface BudgetResult {
  failures: number;
  markdown: string;
}

export function parseBudget(value: unknown): PerfBudget | null {
  if (!isDynamicRecord(value) || !isDynamicRecord(value.scenarios)) return null;
  const budget: PerfBudget = new Map();
  for (const [scenario, limits] of Object.entries(value.scenarios)) {
    if (!isDynamicRecord(limits)) return null;
    const metrics = new Map<string, number>();
    for (const [metric, limit] of Object.entries(limits)) {
      if (!isNumber(limit)) return null;
      metrics.set(metric, limit);
    }
    budget.set(scenario, metrics);
  }
  return budget;
}

export function checkBudget(budget: PerfBudget, report: BenchReport): BudgetResult {
  const rows: string[] = [];
  let failures = 0;
  for (const [scenarioId, limits] of budget) {
    const scenario = report.scenarios.find((one) => one.scenario === scenarioId);
    for (const [metric, limit] of limits) {
      const summary = scenario?.metrics[metric];
      const value = summary?.settled?.median ?? summary?.mean?.median;
      const status = value === undefined ? "missing" : value <= limit ? "pass" : "over";
      if (status !== "pass") failures += 1;
      rows.push(`| ${scenarioId} | ${metric} | ${value ?? "–"} | ${limit} | ${status} |`);
    }
  }
  const markdown = [
    `## Perf budget: ${failures === 0 ? "pass" : `${failures} over or missing`}`,
    "",
    "| Scenario | Metric | Median | Limit | Status |",
    "| --- | --- | ---: | ---: | --- |",
    ...rows,
  ].join("\n");
  return { failures, markdown };
}
