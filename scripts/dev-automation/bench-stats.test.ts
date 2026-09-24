// `dev:bench` numbers go into PR bodies as the reason a fix was made or
// dropped. These cover the arithmetic that is wrong by default: CPU from a
// process that started mid-interval, a provider that exits mid-run, an even
// number of runs, and a compare file that is not a report.
//
// Nothing here waits on a clock. Every input is a literal.
import { describe, expect, it } from "vitest";
import {
  type BenchReport,
  compareReports,
  cpuMetrics,
  median,
  parseBenchReport,
  parseFootprint,
  processMetrics,
  type RunResult,
  seriesStats,
  summarizeRuns,
} from "./bench-stats";
import type { ProcessTableRow } from "./cpu-sampling";

const ELECTRON = "/x/Electron.app/Contents/MacOS/Electron /x/out/main/index.js";

function row(pid: number, ppid: number, rssMb: number, cpuSeconds: number, command: string): ProcessTableRow {
  return { pid, ppid, rssKb: rssMb * 1_024, cpuSeconds, command };
}

describe("median", () => {
  it("averages the two middle values of an even count", () => {
    expect(median([3, 1, 2])).toBe(2);
    expect(median([4, 1, 3, 2])).toBe(2.5);
    expect(median([])).toBe(0);
  });
});

describe("processMetrics", () => {
  it("counts a provider's MCP child as provider and leaves dev tooling out of the total", () => {
    const values = processMetrics([
      row(10, 1, 200, 0, ELECTRON),
      row(11, 10, 150, 0, "/x/Electron Helper (Renderer) --type=renderer"),
      row(12, 10, 300, 0, "/usr/local/bin/claude --output-format stream-json"),
      row(13, 12, 50, 0, "node /x/mcp-server.js"),
      row(14, 1, 400, 0, "node /x/node_modules/.bin/electron-vite preview"),
    ]);
    expect(values).toMatchObject({
      "rss.total": 700,
      "rss.main": 200,
      "rss.renderer": 150,
      "rss.provider": 350,
      "procs.provider": 2,
    });
  });
});

describe("footprint", () => {
  it("reads each process's physical footprint and splits provider memory by executable", () => {
    const footprints = parseFootprint(
      [
        "======================================================================",
        "Electron [10]: 64-bit    Footprint: 104857600 B (16384 bytes per page)",
        "======================================================================",
        "",
        "Auxiliary data:",
        "    phys_footprint: 115343360 B",
        "    phys_footprint_peak: 209715200 B",
        "",
        "======================================================================",
        "opencode [12]: 64-bit    Footprint: 52428800 B (16384 bytes per page)",
        "======================================================================",
        "",
        "======================================================================",
        "Summary Footprint: 167772160 B",
        "======================================================================",
      ].join("\n"),
    );
    expect(footprints).toEqual(
      new Map([
        [10, 110 * 1_024 * 1_024],
        [12, 50 * 1_024 * 1_024],
      ]),
    );
    const values = processMetrics(
      [
        row(10, 1, 200, 0, ELECTRON),
        row(12, 10, 300, 0, "/usr/local/bin/opencode acp"),
        row(13, 10, 100, 0, "/usr/local/bin/grok acp"),
      ],
      footprints,
    );
    expect(values).toMatchObject({
      "mem.total": 160,
      "mem.main": 110,
      "mem.provider": 50,
      "rss.provider.opencode": 300,
      "mem.provider.opencode": 50,
      "procs.provider.grok": 1,
    });
  });
});

describe("cpuMetrics", () => {
  it("drops a process that exists in only one reading instead of counting its whole lifetime", () => {
    const before = [row(10, 1, 100, 10, ELECTRON)];
    const after = [
      row(10, 1, 100, 10.5, ELECTRON),
      row(11, 10, 100, 40, "/x/Electron Helper (Renderer) --type=renderer"),
    ];
    expect(cpuMetrics(before, after, 1_000)).toEqual({ "cpu.main": 50, "cpu.total": 50 });
  });

  it("ignores a recycled pid whose counter went backwards", () => {
    const before = [row(10, 1, 100, 10, ELECTRON)];
    const after = [row(10, 1, 100, 2, ELECTRON)];
    expect(cpuMetrics(before, after, 1_000)).toEqual({ "cpu.total": 0 });
  });
});

describe("seriesStats", () => {
  it("reads a metric missing from a sample as zero, so a released provider lowers the mean", () => {
    const stats = seriesStats([{ "rss.provider": 300 }, {}, { "rss.provider": 0 }]);
    expect(stats["rss.provider"]).toEqual({ peak: 300, mean: 100 });
  });

  it("reads heap metrics only from the ticks that took them, and CPU only from measured intervals", () => {
    const stats = seriesStats([
      { "rss.main": 100, "heap.main": 40 },
      { "rss.main": 100, "cpu.total": 10 },
      { "rss.main": 100, "cpu.total": 20, "heap.main": 60 },
    ]);
    expect(stats["heap.main"]).toEqual({ peak: 60, mean: 50 });
    expect(stats["cpu.total"]).toEqual({ peak: 20, mean: 15 });
  });
});

function run(peak: number, settled: number): RunResult {
  return {
    durationMs: 1_000,
    samples: 2,
    series: { "rss.total": { peak, mean: peak } },
    settled: { "rss.total": settled },
  };
}

function report(label: string, runs: RunResult[]): BenchReport {
  return {
    label,
    createdAt: "2026-09-23T00:00:00.000Z",
    build: "built",
    scenarios: [{ scenario: "s1", description: "idle", runs, metrics: summarizeRuns(runs) }],
  };
}

describe("summarizeRuns and compareReports", () => {
  it("compares medians and keeps the spread of each report", () => {
    const before = report("before", [run(500, 400), run(520, 410), run(900, 420)]);
    const after = report("after", [run(400, 300), run(410, 310), run(420, 320)]);
    expect(before.scenarios[0]?.metrics["rss.total"]?.peak).toEqual({ median: 520, min: 500, max: 900 });
    const settled = compareReports(before, after).find((delta) => delta.stat === "settled");
    expect(settled).toMatchObject({ before: 410, after: 310, delta: -100, percent: -24.4 });
  });

  it("reads a process kind missing from one run as zero, and a recorded value only where recorded", () => {
    const withProvider = (provider: number): RunResult => ({
      durationMs: 1_000,
      samples: 2,
      series: { "mem.total": { peak: 900, mean: 800 }, "mem.provider": { peak: provider, mean: provider } },
      settled: { "mem.total": 500, "mem.provider": provider, "turns.failed": 0 },
    });
    const released: RunResult = {
      durationMs: 1_000,
      samples: 2,
      series: { "mem.total": { peak: 900, mean: 800 } },
      settled: { "mem.total": 400 },
    };
    const metrics = summarizeRuns([released, withProvider(370), released]);
    expect(metrics["mem.provider"]?.settled).toEqual({ median: 0, min: 0, max: 370 });
    expect(metrics["turns.failed"]?.settled).toEqual({ median: 0, min: 0, max: 0 });
  });
});

describe("parseBenchReport", () => {
  it("reads back a written report and refuses a file that is not one", () => {
    const written = report("before", [run(500, 400)]);
    const parsed = parseBenchReport(JSON.parse(JSON.stringify(written)));
    expect(parsed?.scenarios[0]?.metrics["rss.total"]?.settled).toEqual({ median: 400, min: 400, max: 400 });
    expect(parseBenchReport({ label: "cpu", durationMs: 1, samples: 1, processes: [] })).toBeNull();
    expect(parseBenchReport(null)).toBeNull();
  });
});
