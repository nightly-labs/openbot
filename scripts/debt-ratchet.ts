import { readFileSync, writeFileSync } from "node:fs";
import { isDynamicRecord } from "@openbot/contracts/runtime-values";
import { createOpenBotLogger } from "@openbot/logging";

// The shared part of `lint-ratchet.ts` and `type-ratchet.ts`. A baseline file holds the count of
// each check (a Biome rule or a TypeScript option) for each file. A count above the baseline
// fails, so a check stops new debt before the old debt is fixed. `--add=<name>` starts a check at
// its current counts. `--write` lowers the baseline after a fix and never raises it: a higher count
// is a hand edit that a reviewer sees.

type Baseline = Record<string, Record<string, number>>;

export interface DebtRatchet {
  /** The logger name and the `bun run` script, such as `lint:ratchet`. */
  script: string;
  baselinePath: string;
  /** What one count is, in the plural: `findings` or `errors`. */
  noun: string;
  /** What to do when a check has no debt left. */
  finishedStep: string;
  /** How to see the debt that failed. */
  inspectHint: string;
  /** Counts by check name and then by file path. */
  count(names: readonly string[]): Map<string, Map<string, number>>;
}

export function runDebtRatchet(ratchet: DebtRatchet): void {
  const { baselinePath, noun } = ratchet;
  const write = process.argv.includes("--write");
  const added = process.argv.flatMap((argument) => (argument.startsWith("--add=") ? [argument.slice(6)] : []));
  const logger = createOpenBotLogger(ratchet.script.replace(":", "-"));

  const baseline = readBaseline(baselinePath);
  for (const name of added) {
    if (Object.hasOwn(baseline, name)) throw new Error(`${name} is already in the baseline.`);
  }
  const names = [...new Set([...Object.keys(baseline), ...added])];
  const actual = ratchet.count(names);
  const failures: string[] = [];
  const lowered: string[] = [];
  const next: Baseline = {};

  for (const name of names) {
    const found = actual.get(name) ?? new Map<string, number>();
    const allowed = baseline[name] ?? Object.fromEntries(found);
    const kept: Record<string, number> = {};
    for (const [path, count] of found) {
      const limit = allowed[path] ?? 0;
      if (count > limit) failures.push(`${name}: ${path} has ${count} ${noun}; the baseline allows ${limit}.`);
      kept[path] = Math.min(count, limit);
    }
    for (const [path, limit] of Object.entries(allowed)) {
      const count = found.get(path) ?? 0;
      if (count < limit) lowered.push(`${name}: ${path} has ${count} ${noun}; the baseline allows ${limit}.`);
    }
    next[name] = Object.fromEntries(Object.entries(kept).filter(([, count]) => count > 0));
    if (Object.keys(allowed).length > 0 && Object.keys(next[name]).length === 0) {
      lowered.push(`${name} has no ${noun} left. ${ratchet.finishedStep}`);
    }
  }

  if (failures.length > 0) {
    logger.error(
      [
        `New ${noun} for a ratcheted check. Fix them; do not raise the baseline:`,
        ...failures.map((line) => `  ${line}`),
        ratchet.inspectHint,
      ].join("\n"),
    );
  }
  if (added.length > 0 || (lowered.length > 0 && write)) {
    writeFileSync(baselinePath, `${JSON.stringify(sorted(next), null, 2)}\n`);
    logger.info(["Wrote the baseline.", ...lowered.map((line) => `  ${line}`)].join("\n"));
  } else if (lowered.length > 0) {
    logger.error(
      [
        `The baseline is higher than the ${noun}. Run \`bun run ${ratchet.script} --write\` and commit it:`,
        ...lowered.map((line) => `  ${line}`),
      ].join("\n"),
    );
  }
  if (failures.length > 0 || (lowered.length > 0 && !write && added.length === 0)) process.exit(1);
}

function readBaseline(path: string): Baseline {
  const parsed = JSON.parse(readFileSync(path, "utf8"));
  if (!isDynamicRecord(parsed)) throw new Error(`${path} must hold an object.`);
  const result: Baseline = {};
  for (const [name, files] of Object.entries(parsed)) {
    if (!isDynamicRecord(files)) throw new Error(`${path}: ${name} must map paths to counts.`);
    result[name] = {};
    for (const [file, count] of Object.entries(files)) {
      if (typeof count !== "number" || !Number.isInteger(count) || count < 1) {
        throw new Error(`${path}: ${name} ${file} must be a positive integer.`);
      }
      result[name][file] = count;
    }
  }
  return result;
}

function sorted(value: Baseline): Baseline {
  return Object.fromEntries(
    Object.entries(value)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([name, files]) => [
        name,
        Object.fromEntries(Object.entries(files).sort(([left], [right]) => left.localeCompare(right))),
      ]),
  );
}
