import { spawnSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { isDynamicRecord } from "@openbot/contracts/runtime-values";
import { createOpenBotLogger } from "@openbot/logging";

// Holds TypeScript options that are not yet on in tsconfig.base.json to the error count of each file
// in tools/typescript/type-baseline.json. It runs `tsc` once for each project and option, with the
// option turned on. A new error fails, so an option stops new debt before the old debt is fixed.
// `--add=<option>` starts an option at its current counts. `--write` lowers the baseline after a fix
// and never raises it. When an option has no errors left, turn it on in tsconfig.base.json and
// remove it from the baseline.

type Baseline = Record<string, Record<string, number>>;

const ROOT = resolve(import.meta.dirname, "..");
const BASELINE_PATH = resolve(ROOT, "tools/typescript/type-baseline.json");
// The projects that `typecheck:node` and `typecheck:renderer` check.
const PROJECTS = ["tsconfig.node.json", "tsconfig.web.json"];
const ERROR_LINE = /^(.+?)\(\d+,\d+\): error TS\d+: /;
const write = process.argv.includes("--write");
const added = process.argv.flatMap((argument) => (argument.startsWith("--add=") ? [argument.slice(6)] : []));
const logger = createOpenBotLogger("type-ratchet");

const baseline = readBaseline();
const options = [...new Set([...Object.keys(baseline), ...added])];
for (const option of added) {
  if (Object.hasOwn(baseline, option)) throw new Error(`${option} is already in the baseline.`);
}
const failures: string[] = [];
const lowered: string[] = [];
const next: Baseline = {};

for (const option of options) {
  const found = countErrors(option);
  const allowed = baseline[option] ?? Object.fromEntries(found);
  const kept: Record<string, number> = {};
  for (const [path, count] of found) {
    const limit = allowed[path] ?? 0;
    if (count > limit) failures.push(`${option}: ${path} has ${count} errors; the baseline allows ${limit}.`);
    kept[path] = Math.min(count, limit);
  }
  for (const [path, limit] of Object.entries(allowed)) {
    const count = found.get(path) ?? 0;
    if (count < limit) lowered.push(`${option}: ${path} has ${count} errors; the baseline allows ${limit}.`);
  }
  next[option] = Object.fromEntries(Object.entries(kept).filter(([, count]) => count > 0));
  if (Object.keys(allowed).length > 0 && Object.keys(next[option]).length === 0) {
    lowered.push(`${option} has no errors left. Turn it on in tsconfig.base.json and remove it from the baseline.`);
  }
}

if (failures.length > 0) {
  logger.error(
    [
      "New type errors for a ratcheted option. Fix them; do not raise the baseline:",
      ...failures.map((line) => `  ${line}`),
      "Run `bun node_modules/typescript/bin/tsc --noEmit -p <project> --<option>` to see them.",
    ].join("\n"),
  );
}
if (added.length > 0 || (lowered.length > 0 && write)) {
  writeFileSync(BASELINE_PATH, `${JSON.stringify(sorted(next), null, 2)}\n`);
  logger.info(["Wrote the baseline.", ...lowered.map((line) => `  ${line}`)].join("\n"));
} else if (lowered.length > 0) {
  logger.error(
    [
      "The baseline is higher than the errors. Run `bun run types:ratchet --write` and commit it:",
      ...lowered.map((line) => `  ${line}`),
    ].join("\n"),
  );
}
if (failures.length > 0 || (lowered.length > 0 && !write && added.length === 0)) process.exit(1);

function readBaseline(): Baseline {
  const parsed = JSON.parse(readFileSync(BASELINE_PATH, "utf8"));
  if (!isDynamicRecord(parsed)) throw new Error(`${BASELINE_PATH} must hold an object.`);
  const result: Baseline = {};
  for (const [option, files] of Object.entries(parsed)) {
    if (!isDynamicRecord(files)) throw new Error(`${BASELINE_PATH}: ${option} must map paths to counts.`);
    result[option] = {};
    for (const [path, count] of Object.entries(files)) {
      if (typeof count !== "number" || !Number.isInteger(count) || count < 1) {
        throw new Error(`${BASELINE_PATH}: ${option} ${path} must be a positive integer.`);
      }
      result[option][path] = count;
    }
  }
  return result;
}

// Error counts by file for one option, over all projects. A file that two projects include counts
// each error once.
function countErrors(option: string): Map<string, number> {
  const errors = new Set<string>();
  for (const project of PROJECTS) {
    // `--incremental false` keeps this run from replacing the build info of the normal typecheck.
    const result = spawnSync(
      process.execPath,
      [
        resolve(ROOT, "node_modules/typescript/bin/tsc"),
        "--noEmit",
        "--pretty",
        "false",
        "--incremental",
        "false",
        "-p",
        project,
        `--${option}`,
      ],
      { cwd: ROOT, encoding: "utf8", maxBuffer: 256 * 1024 * 1024 },
    );
    const lines = result.stdout.split("\n").filter((line) => ERROR_LINE.test(line));
    if (result.status !== 0 && lines.length === 0) {
      throw new Error(`tsc failed on ${project} without type errors:\n${result.stdout}${result.stderr}`);
    }
    for (const line of lines) errors.add(line);
  }
  const counts = new Map<string, number>();
  for (const line of errors) {
    const path = ERROR_LINE.exec(line)?.[1];
    if (path) counts.set(path, (counts.get(path) ?? 0) + 1);
  }
  return counts;
}

function sorted(value: Baseline): Baseline {
  return Object.fromEntries(
    Object.entries(value)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([option, files]) => [
        option,
        Object.fromEntries(Object.entries(files).sort(([left], [right]) => left.localeCompare(right))),
      ]),
  );
}
