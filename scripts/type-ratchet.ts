import { spawnSync } from "node:child_process";
import { resolve } from "node:path";
import { runDebtRatchet } from "./debt-ratchet";

// Holds TypeScript options that are not yet on in tsconfig.base.json to the error count of each file
// in tools/typescript/type-baseline.json. It runs `tsc` once for each project and option, with the
// option turned on. `scripts/debt-ratchet.ts` has the rules of the baseline. When an option has no
// errors left, turn it on in tsconfig.base.json and remove it from the baseline.

const ROOT = resolve(import.meta.dirname, "..");
// Every project that extends tsconfig.base.json. apps/mobile extends the Expo base config.
const PROJECTS = [
  "tsconfig.node.json",
  "tsconfig.web.json",
  "apps/auth-api/tsconfig.json",
  "packages/brand/tsconfig.json",
  "packages/contracts/tsconfig.json",
  "packages/i18n/tsconfig.json",
  "packages/logging/tsconfig.json",
  "packages/team-client/tsconfig.json",
  "packages/user-errors/tsconfig.json",
];
const ERROR_LINE = /^(.+?)\(\d+,\d+\): error TS\d+: /;

runDebtRatchet({
  script: "types:ratchet",
  baselinePath: resolve(ROOT, "tools/typescript/type-baseline.json"),
  noun: "errors",
  finishedStep: "Turn it on in tsconfig.base.json and remove it from the baseline.",
  inspectHint: "Run `bun node_modules/typescript/bin/tsc --noEmit -p <project> --<option>` to see them.",
  count: (options) => new Map(options.map((option) => [option, countErrors(option)])),
});

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
