import { readFileSync } from "node:fs";
import { relative } from "node:path";
import { fileURLToPath } from "node:url";
import { BaseSequencer, type TestSpecification } from "vitest/node";

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
  return sorted[Math.floor(sorted.length / 2)] ?? 1;
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
    const ordered = [...specifications].sort(
      (left, right) => seconds(right) - seconds(left) || left.moduleId.localeCompare(right.moduleId),
    );
    for (const specification of ordered) {
      const shortest = shards.reduce((left, right) => (right.total < left.total ? right : left));
      shortest.total += seconds(specification);
      shortest.files.push(specification);
    }

    const current = shards[shard.index - 1];
    if (!current) throw new Error(`Shard ${shard.index} of ${shard.count} does not exist.`);
    return super.sort(current.files);
  }
}
