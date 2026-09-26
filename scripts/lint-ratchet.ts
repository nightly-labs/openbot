import { spawnSync } from "node:child_process";
import { resolve } from "node:path";
import { isDynamicRecord } from "@openbot/contracts/runtime-values";
import { runDebtRatchet } from "./debt-ratchet";

// Holds Biome rules that are not yet on in biome.json to the finding count of each file in
// tools/biome/lint-baseline.json. `scripts/debt-ratchet.ts` has the rules of the baseline. When a
// rule has no findings left, turn it on in biome.json and remove it from the baseline.

const ROOT = resolve(import.meta.dirname, "..");

const PLUGIN_PREFIX = "plugin/";
// Every built-in rule group. Skipping them all leaves only the GritQL plugins, which `--only` cannot
// select.
const RULE_GROUPS = ["a11y", "complexity", "correctness", "nursery", "performance", "security", "style", "suspicious"];

runDebtRatchet({
  script: "lint:ratchet",
  baselinePath: resolve(ROOT, "tools/biome/lint-baseline.json"),
  noun: "findings",
  finishedStep: "Turn it on in biome.json and remove it from the baseline.",
  inspectHint: "Run `bunx biome lint --only=<rule> <path>` to see them, or `bunx biome lint <path>` for a plugin rule.",
  count: countFindings,
});

// Finding counts by rule and then by file, from Biome runs over the repository. A name such as
// `nursery/noFloatingPromises` is a built-in rule. `plugin/<name>` is a GritQL plugin whose message
// starts with `[<name>]`, because Biome reports every plugin under the one category `plugin`.
function countFindings(names: readonly string[]): Map<string, Map<string, number>> {
  const counts = new Map<string, Map<string, number>>();
  const rules = names.filter((name) => !name.startsWith(PLUGIN_PREFIX));
  const plugins = names.filter((name) => name.startsWith(PLUGIN_PREFIX));
  if (rules.length > 0) {
    for (const { category, path } of lint(rules.map((name) => `--only=${name}`))) {
      if (category.startsWith("lint/")) add(counts, category.slice("lint/".length), path);
    }
  }
  if (plugins.length > 0) {
    for (const { category, path, message } of lint(RULE_GROUPS.map((group) => `--skip=${group}`))) {
      if (category !== "plugin") continue;
      const name = plugins.find((plugin) => message.startsWith(`[${plugin.slice(PLUGIN_PREFIX.length)}]`));
      if (name) add(counts, name, path);
    }
  }
  return counts;
}

function add(counts: Map<string, Map<string, number>>, name: string, path: string): void {
  const files = counts.get(name) ?? new Map<string, number>();
  files.set(path, (files.get(path) ?? 0) + 1);
  counts.set(name, files);
}

interface Finding {
  category: string;
  path: string;
  message: string;
}

function lint(selection: readonly string[]): Finding[] {
  const result = spawnSync(
    resolve(ROOT, "node_modules/.bin/biome"),
    ["lint", ...selection, "--max-diagnostics=none", "--reporter=json", "."],
    { cwd: ROOT, encoding: "utf8", maxBuffer: 256 * 1024 * 1024 },
  );
  const report = JSON.parse(result.stdout);
  if (!isDynamicRecord(report) || !Array.isArray(report.diagnostics)) {
    throw new Error(`Biome did not print a JSON report: ${result.stderr}`);
  }
  const findings: Finding[] = [];
  for (const diagnostic of report.diagnostics) {
    if (!isDynamicRecord(diagnostic) || !isDynamicRecord(diagnostic.location)) continue;
    const { category, message } = diagnostic;
    const { path } = diagnostic.location;
    if (typeof category !== "string" || typeof path !== "string") continue;
    findings.push({ category, path, message: typeof message === "string" ? message : "" });
  }
  return findings;
}
