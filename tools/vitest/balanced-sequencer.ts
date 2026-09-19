import { readFileSync } from "node:fs";
import { relative } from "node:path";
import { fileURLToPath } from "node:url";
import { BaseSequencer, type TestSpecification } from "vitest/node";

/**
 * Splits the suite across CI shards by measured duration, not by file size.
 *
 * `--shard` on its own sorts the files by size and cuts the sorted list into contiguous pieces, so
 * the biggest files land together. That is close to the worst split this suite can take, because
 * size does not predict duration here: `openbot-database.test.ts` is the largest file in the repo
 * and runs in 1.8s, while `grok-client.test.ts` is half its size and takes 53s. Measured against
 * the recorded durations, two built-in shards put 643s of the 693s in one of them.
 *
 * So the durations are recorded instead, and each file goes to whichever shard is currently
 * shortest, longest file first. That is the standard greedy fit, and on this suite it reaches the
 * even split exactly: 347s and 346s across two shards.
 *
 * The table is a measurement, so it goes stale. A file that is not in it is assumed to be the
 * median, which keeps a new test file from all landing in shard one; `bun run test:durations`
 * rewrites the table. Being stale costs balance and nothing else - every file still runs exactly
 * once, in some shard, whatever the table says.
 */

/**
 * The table is generated, so a malformed entry means the generator broke rather than that this file
 * has a bad input. Skipping such an entry leaves the file on the median, which is what an unrecorded
 * file already gets - a wrong shard split is a slower CI job, never a test that does not run.
 */
function readDurations(): Record<string, number> {
  const durations: Record<string, number> = {};
  const table = JSON.parse(readFileSync(new URL("./test-durations.json", import.meta.url), "utf8"));
  for (const [path, value] of Object.entries(table)) {
    if (typeof value === "number" && Number.isFinite(value)) durations[path] = value;
  }
  return durations;
}

const DURATIONS = readDurations();

const ROOT = fileURLToPath(new URL("../..", import.meta.url));

const MEDIAN_SECONDS = median(Object.values(DURATIONS));

function median(values: number[]): number {
  if (values.length === 0) return 1;
  const sorted = [...values].sort((left, right) => left - right);
  return sorted[Math.floor(sorted.length / 2)];
}

function seconds(specification: TestSpecification): number {
  return DURATIONS[relative(ROOT, specification.moduleId)] ?? MEDIAN_SECONDS;
}

export default class BalancedSequencer extends BaseSequencer {
  override async shard(specifications: TestSpecification[]): Promise<TestSpecification[]> {
    const shard = this.ctx.config.shard;
    if (!shard) return specifications;

    interface Shard {
      total: number;
      files: TestSpecification[];
    }

    const shards: Shard[] = Array.from({ length: shard.count }, () => ({ total: 0, files: [] }));
    // Sorted by path first, so two runners given the same table always agree on the same split.
    const ordered = [...specifications].sort(
      (left, right) => seconds(right) - seconds(left) || left.moduleId.localeCompare(right.moduleId),
    );
    for (const specification of ordered) {
      const shortest = shards.reduce((left, right) => (right.total < left.total ? right : left));
      shortest.total += seconds(specification);
      shortest.files.push(specification);
    }

    return super.sort(shards[shard.index - 1].files);
  }
}
