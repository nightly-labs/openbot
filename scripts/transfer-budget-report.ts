import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { isDynamicRecord, isNumber } from "@openbot/contracts/runtime-values";

// Prints a Markdown table that compares the transfer budget reports of a pull request with the
// reports of `main`. Each argument is a directory. The script reads every `*.json` file below it and
// merges their `measured` and `budgets` values, so the shard and file layout does not matter.
// A missing `main` directory gives an empty `main` column. The budget tests fail CI on their own;
// this report only shows the change. The reports come from pull request code, so a metric name must
// be a plain identifier before it goes into the comment.

interface Report {
  measured: Map<string, number>;
  budgets: Map<string, number>;
}

const METRIC_NAME = /^[A-Za-z][A-Za-z0-9]{0,63}$/;

const [prDirectory, mainDirectory] = process.argv.slice(2);
if (!prDirectory || !mainDirectory) {
  throw new Error("Usage: bun scripts/transfer-budget-report.ts <pull request directory> <main directory>");
}
const pr = readReports(prDirectory);
const main = readReports(mainDirectory);

const rows = [...new Set([...pr.measured.keys(), ...main.measured.keys()])].sort().map((metric) => {
  const before = main.measured.get(metric);
  const after = pr.measured.get(metric);
  const cap = pr.budgets.get(metric) ?? main.budgets.get(metric);
  return `| \`${metric}\` | ${format(before)} | ${format(after)} | ${change(before, after)} | ${format(cap)} |`;
});
const lines = ["| Metric | main | This PR | Change | Cap |", "| --- | ---: | ---: | ---: | ---: |", ...rows];
if (rows.length === 0) lines.push("", "No transfer budget report was found for this pull request.");
process.stdout.write(`${lines.join("\n")}\n`);

function readReports(directory: string): Report {
  const report: Report = { measured: new Map(), budgets: new Map() };
  if (!existsSync(directory)) return report;
  for (const entry of readdirSync(directory, { recursive: true, encoding: "utf8" })) {
    if (!entry.endsWith(".json")) continue;
    const value = JSON.parse(readFileSync(join(directory, entry), "utf8"));
    if (!isDynamicRecord(value)) throw new Error(`${entry} is not a transfer budget report.`);
    merge(report.measured, value.measured, entry);
    merge(report.budgets, value.budgets, entry);
  }
  return report;
}

function merge(target: Map<string, number>, values: unknown, entry: string): void {
  if (!isDynamicRecord(values)) throw new Error(`${entry} has no measured values or budgets.`);
  for (const [metric, value] of Object.entries(values)) {
    if (!METRIC_NAME.test(metric)) throw new Error(`${entry} has a metric name that is not an identifier.`);
    if (!isNumber(value)) throw new Error(`${entry}: ${metric} is not a number.`);
    target.set(metric, value);
  }
}

function format(value: number | undefined): string {
  return value === undefined ? "–" : value.toLocaleString("en-US");
}

function change(before: number | undefined, after: number | undefined): string {
  if (before === undefined || after === undefined) return "–";
  if (before === after) return "0";
  const difference = after - before;
  const sign = difference > 0 ? "+" : "";
  const percent = before === 0 ? "" : ` (${sign}${((difference / before) * 100).toFixed(1)}%)`;
  return `${sign}${difference.toLocaleString("en-US")}${percent}`;
}
