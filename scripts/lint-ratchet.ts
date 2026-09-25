import { spawnSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { isDynamicRecord } from "@openbot/contracts/runtime-values";
import { createOpenBotLogger } from "@openbot/logging";

// Holds Biome rules that are not yet on in biome.json to the finding count of each file in
// tools/biome/lint-baseline.json. A new finding fails, so a rule stops new debt before the old
// debt is fixed. `--add=<rule>` starts a rule at its current counts. `--write` lowers the baseline
// after a fix and never raises it: a higher count is a hand edit that a reviewer sees. When a rule
// has no findings left, turn it on in biome.json and remove it from the baseline.

type Baseline = Record<string, Record<string, number>>;

const ROOT = resolve(import.meta.dirname, "..");
const BASELINE_PATH = resolve(ROOT, "tools/biome/lint-baseline.json");
const write = process.argv.includes("--write");
const added = process.argv.flatMap((argument) => (argument.startsWith("--add=") ? [argument.slice(6)] : []));
const logger = createOpenBotLogger("lint-ratchet");

const baseline = readBaseline();
const rules = [...new Set([...Object.keys(baseline), ...added])];
const actual = countFindings(rules);
for (const rule of added) {
  if (Object.hasOwn(baseline, rule)) throw new Error(`${rule} is already in the baseline.`);
  baseline[rule] = Object.fromEntries(actual.get(rule) ?? []);
}
const failures: string[] = [];
const lowered: string[] = [];
const next: Baseline = {};

for (const rule of rules) {
  const allowed = baseline[rule] ?? {};
  const found = actual.get(rule) ?? new Map<string, number>();
  const kept: Record<string, number> = {};
  for (const [path, count] of found) {
    const limit = allowed[path] ?? 0;
    if (count > limit) failures.push(`${rule}: ${path} has ${count} findings; the baseline allows ${limit}.`);
    kept[path] = Math.min(count, limit);
  }
  for (const [path, limit] of Object.entries(allowed)) {
    const count = found.get(path) ?? 0;
    if (count < limit) lowered.push(`${rule}: ${path} has ${count} findings; the baseline allows ${limit}.`);
  }
  next[rule] = Object.fromEntries(Object.entries(kept).filter(([, count]) => count > 0));
  if (Object.keys(allowed).length > 0 && Object.keys(next[rule]).length === 0) {
    lowered.push(`${rule} has no findings left. Turn it on in biome.json and remove it from the baseline.`);
  }
}

if (failures.length > 0) {
  logger.error(
    [
      "New lint findings for a ratcheted rule. Fix them; do not raise the baseline:",
      ...failures.map((line) => `  ${line}`),
      `Run \`bunx biome lint --only=<rule> <path>\` to see them.`,
    ].join("\n"),
  );
}
if (added.length > 0 || (lowered.length > 0 && write)) {
  writeFileSync(BASELINE_PATH, `${JSON.stringify(sorted(next), null, 2)}\n`);
  logger.info(["Wrote the baseline.", ...lowered.map((line) => `  ${line}`)].join("\n"));
} else if (lowered.length > 0) {
  logger.error(
    [
      "The baseline is higher than the findings. Run `bun run lint:ratchet --write` and commit it:",
      ...lowered.map((line) => `  ${line}`),
    ].join("\n"),
  );
}
if (failures.length > 0 || (lowered.length > 0 && !write && added.length === 0)) process.exit(1);

function readBaseline(): Baseline {
  const parsed = JSON.parse(readFileSync(BASELINE_PATH, "utf8"));
  if (!isDynamicRecord(parsed)) throw new Error(`${BASELINE_PATH} must hold an object.`);
  const result: Baseline = {};
  for (const [rule, files] of Object.entries(parsed)) {
    if (!isDynamicRecord(files)) throw new Error(`${BASELINE_PATH}: ${rule} must map paths to counts.`);
    result[rule] = {};
    for (const [path, count] of Object.entries(files)) {
      if (typeof count !== "number" || !Number.isInteger(count) || count < 1) {
        throw new Error(`${BASELINE_PATH}: ${rule} ${path} must be a positive integer.`);
      }
      result[rule][path] = count;
    }
  }
  return result;
}

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

function sorted(value: Baseline): Baseline {
  return Object.fromEntries(
    Object.entries(value)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([rule, files]) => [
        rule,
        Object.fromEntries(Object.entries(files).sort(([left], [right]) => left.localeCompare(right))),
      ]),
  );
}
