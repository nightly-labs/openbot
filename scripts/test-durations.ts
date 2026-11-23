import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = fileURLToPath(new URL("..", import.meta.url));
const TABLE = join(ROOT, "tools/vitest/test-durations.json");

const report = join(mkdtempSync(join(tmpdir(), "openbot-durations-")), "report.json");
const run = spawnSync("bun", ["run", "test:desktop", "--", "--reporter=json", `--outputFile=${report}`], {
  cwd: ROOT,
  stdio: "inherit",
});
if (run.error) throw run.error;

function fileDurations(report: unknown): [string, number][] {
  if (typeof report !== "object" || report === null || !("testResults" in report)) {
    throw new Error("The vitest report has no testResults.");
  }
  const { testResults } = report;
  if (!Array.isArray(testResults)) throw new Error("The vitest report's testResults is not a list.");

  const durations: [string, number][] = [];
  for (const result of testResults) {
    if (typeof result !== "object" || result === null) continue;
    const name = "name" in result ? result.name : undefined;
    const startTime = "startTime" in result ? result.startTime : undefined;
    const endTime = "endTime" in result ? result.endTime : undefined;
    if (typeof name !== "string" || typeof startTime !== "number" || typeof endTime !== "number") continue;
    durations.push([relative(ROOT, name), Math.round((endTime - startTime) / 10) / 100]);
  }
  return durations.sort(([left], [right]) => left.localeCompare(right));
}

const durations = Object.fromEntries(fileDurations(JSON.parse(readFileSync(report, "utf8"))));

writeFileSync(TABLE, `${JSON.stringify(durations, null, 2)}\n`);
const total = Object.values(durations).reduce((sum, seconds) => sum + seconds, 0);
process.stdout.write(`Recorded ${Object.keys(durations).length} files, ${total.toFixed(0)}s total.\n`);
