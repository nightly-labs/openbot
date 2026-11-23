import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { z } from "zod";
import { isNewerMobileVersion } from "../packages/contracts/src/mobile-features";
import { isNewerRelease } from "../packages/contracts/src/release-version";
import { isNewerRelease as isNewerMacHostRelease } from "./host-manager-macos";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const REPORT = join(root, ".openbot-build", "release-version-comparator-e2e.json");
const HOSTED_UPDATE = join(root, "scripts", "hosting", "openbot-hosted-update");
const STABLE = /^\d+\.\d+\.\d+$/u;

const casesSchema = z.object({
  cases: z.array(
    z.object({
      candidate: z.string(),
      current: z.string(),
      newer: z.boolean(),
      bash: z.boolean().optional(),
      note: z.string().optional(),
    }),
  ),
});
const { cases } = casesSchema.parse(
  JSON.parse(readFileSync(join(root, "scripts", "release-version-cases.json"), "utf8")),
);

interface Result {
  comparator: string;
  candidate: string;
  current: string;
  expected: boolean;
  actual: boolean | string;
  passed: boolean;
}
const results: Result[] = [];
function record(comparator: string, candidate: string, current: string, expected: boolean, actual: boolean | string) {
  results.push({ comparator, candidate, current, expected, actual, passed: actual === expected });
}

for (const { candidate, current, newer } of cases) {
  record("contracts isNewerRelease", candidate, current, newer, isNewerRelease(candidate, current));
  if (STABLE.test(candidate) && STABLE.test(current) && !/(^|\.)0\d/u.test(`${candidate}.${current}`))
    record("mobile isNewerMobileVersion", candidate, current, newer, isNewerMobileVersion(candidate, current));
  if (STABLE.test(candidate) && STABLE.test(current))
    record("macOS host isNewerRelease", candidate, current, newer, isNewerMacHostRelease(candidate, current));
}

const bashCases = cases.flatMap((entry) => (entry.bash === undefined ? [] : [{ ...entry, bash: entry.bash }]));
const bash = Bun.spawnSync(
  [
    "bash",
    "-c",
    'source "$1"; while IFS=$\'\\t\' read -r candidate current; do if newer "$candidate" "$current"; then echo 1; else echo 0; fi; done',
    "release-version-comparator-e2e",
    HOSTED_UPDATE,
  ],
  { stdin: Buffer.from(bashCases.map(({ candidate, current }) => `${candidate}\t${current}\n`).join("")) },
);
const answers = bash.stdout.toString().trim().split("\n");
bashCases.forEach(({ candidate, current, bash: expected }, index) => {
  const answer = answers[index];
  const actual = answer === "1" ? true : answer === "0" ? false : `no answer (exit ${bash.exitCode})`;
  record("bash newer()", candidate, current, expected, actual);
});

mkdirSync(dirname(REPORT), { recursive: true });
const passed = results.every((entry) => entry.passed) && bash.exitCode === 0;
writeFileSync(
  REPORT,
  `${JSON.stringify({ passed, bashExitCode: bash.exitCode, bashStderr: bash.stderr.toString(), results }, null, 2)}\n`,
);
const comparators = [...new Set(results.map((entry) => entry.comparator))];
for (const comparator of comparators) {
  const own = results.filter((entry) => entry.comparator === comparator);
  const failed = own.filter((entry) => !entry.passed);
  process.stdout.write(`${failed.length === 0 ? "pass" : "FAIL"}  ${comparator} (${own.length} pairs)\n`);
  for (const entry of failed)
    process.stdout.write(
      `      ${JSON.stringify(entry.candidate)} vs ${JSON.stringify(entry.current)}: expected ${entry.expected}, got ${entry.actual}\n`,
    );
}
if (bash.exitCode !== 0) process.stdout.write(`bash exited with ${bash.exitCode}: ${bash.stderr.toString()}\n`);
process.stdout.write(`\nReport: ${REPORT}\n`);
process.exit(passed ? 0 : 1);
