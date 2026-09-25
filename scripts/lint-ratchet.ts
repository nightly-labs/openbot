import { spawnSync } from "node:child_process";
import { resolve } from "node:path";
import { isDynamicRecord } from "@openbot/contracts/runtime-values";
import { runDebtRatchet } from "./debt-ratchet";

// Holds Biome rules that are not yet on in biome.json to the finding count of each file in
// tools/biome/lint-baseline.json. `scripts/debt-ratchet.ts` has the rules of the baseline. When a
// rule has no findings left, turn it on in biome.json and remove it from the baseline.

const ROOT = resolve(import.meta.dirname, "..");

runDebtRatchet({
  script: "lint:ratchet",
  baselinePath: resolve(ROOT, "tools/biome/lint-baseline.json"),
  noun: "findings",
  finishedStep: "Turn it on in biome.json and remove it from the baseline.",
  inspectHint: "Run `bunx biome lint --only=<rule> <path>` to see them.",
  count: countFindings,
});

// Finding counts by rule and then by file, from one Biome run over the repository.
function countFindings(names: readonly string[]): Map<string, Map<string, number>> {
  const counts = new Map<string, Map<string, number>>();
  if (names.length === 0) return counts;
  const result = spawnSync(
    resolve(ROOT, "node_modules/.bin/biome"),
    ["lint", ...names.map((name) => `--only=${name}`), "--max-diagnostics=none", "--reporter=json", "."],
    { cwd: ROOT, encoding: "utf8", maxBuffer: 256 * 1024 * 1024 },
  );
  const report = JSON.parse(result.stdout);
  if (!isDynamicRecord(report) || !Array.isArray(report.diagnostics)) {
    throw new Error(`Biome did not print a JSON report: ${result.stderr}`);
  }
  for (const diagnostic of report.diagnostics) {
    if (!isDynamicRecord(diagnostic) || !isDynamicRecord(diagnostic.location)) continue;
    const { category } = diagnostic;
    const { path } = diagnostic.location;
    if (typeof category !== "string" || typeof path !== "string" || !category.startsWith("lint/")) continue;
    const rule = category.slice("lint/".length);
    const files = counts.get(rule) ?? new Map<string, number>();
    files.set(path, (files.get(path) ?? 0) + 1);
    counts.set(rule, files);
  }
  return counts;
}
