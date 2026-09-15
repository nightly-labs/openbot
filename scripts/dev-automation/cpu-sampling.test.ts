// A profiler that is wrong is worse than no profiler: every fix decision it
// gates would be made on a confident number that does not move. So what these
// cover is the arithmetic that is wrong by default - the `ps` time formats, the
// processes that come and go inside a run, and the rule that tells the Electron
// main process apart from the dev server that started it.
//
// Nothing here waits on a clock. Every input is a literal.
import { describe, expect, it } from "vitest";
import {
  classifyChromiumProcess,
  collectDescendants,
  cpuPercentBetween,
  type ProcessSnapshot,
  parseCpuReport,
  parseProcessTable,
  parseProcessTime,
  snapshotProcesses,
  summarize,
} from "./cpu-sampling";

function snapshot(pid: number, cpuSeconds: number, type: ProcessSnapshot["type"] = "renderer"): ProcessSnapshot {
  return { pid, type, cpuSeconds };
}

describe("parseProcessTime", () => {
  it("reads the minutes, hours and days formats ps prints", () => {
    expect(parseProcessTime("0:00.00")).toBe(0);
    expect(parseProcessTime("1:02.34")).toBeCloseTo(62.34, 5);
    expect(parseProcessTime("123:45.60")).toBeCloseTo(7_425.6, 5);
    expect(parseProcessTime("01:02:03.45")).toBeCloseTo(3_723.45, 5);
    expect(parseProcessTime("2-03:04:05")).toBe(183_845);
  });

  it("answers null instead of NaN for a field that is not a time", () => {
    expect(parseProcessTime("")).toBeNull();
    expect(parseProcessTime("CPU")).toBeNull();
    expect(parseProcessTime("12")).toBeNull();
    // Seconds and minutes above 59 mean the columns were misread.
    expect(parseProcessTime("1:60.00")).toBeNull();
    expect(parseProcessTime("1:60:00")).toBeNull();
    // ps only prints a day field with a full HH:MM:SS.
    expect(parseProcessTime("2-03:04")).toBeNull();
  });
});

describe("classifyChromiumProcess", () => {
  it("calls the Electron binary without a --type= switch the main process", () => {
    const electron =
      "/worktree/node_modules/electron/dist/Electron.app/Contents/MacOS/Electron /worktree/out/main/index.js";
    expect(classifyChromiumProcess(electron)).toBe("main");
  });

  it("does not mistake the dev server that started Electron for the main process", () => {
    expect(classifyChromiumProcess("/opt/homebrew/bin/bun scripts/dev-services.ts app")).toBe("other");
    expect(classifyChromiumProcess("node /worktree/node_modules/.bin/electron-vite dev")).toBe("other");
  });

  it("reads the child kind out of the --type= switch", () => {
    expect(classifyChromiumProcess("/x/Electron Helper (Renderer) --type=renderer --lang=en")).toBe("renderer");
    expect(classifyChromiumProcess("/x/Electron Helper (GPU) --type=gpu-process")).toBe("gpu");
    expect(classifyChromiumProcess("/x/chrome_crashpad_handler --type=crashpad-handler")).toBe("crashpad");
    expect(classifyChromiumProcess("/x/Electron Helper --type=utility --utility-sub-type=node.mojom.NodeService")).toBe(
      "utility",
    );
    expect(
      classifyChromiumProcess("/x/Electron Helper --type=utility --utility-sub-type=network.mojom.NetworkService"),
    ).toBe("network");
  });
});

describe("parseProcessTable and collectDescendants", () => {
  const table = [
    "  100     1 0:10.00 /opt/homebrew/bin/bun scripts/dev-services.ts app",
    "  101   100 1:00.00 /w/node_modules/electron/dist/Electron.app/Contents/MacOS/Electron /w/out/main/index.js",
    "  102   101 0:30.00 /w/Electron Helper (Renderer) --type=renderer",
    "  103   101 nonsense /w/Electron Helper (GPU) --type=gpu-process",
    "  900     1 5:00.00 /Applications/Other.app/Contents/MacOS/Other",
    "PID PPID TIME COMMAND",
  ].join("\n");

  it("drops a row whose time field cannot be read", () => {
    const rows = parseProcessTable(table);
    expect(rows.map((row) => row.pid)).toEqual([100, 101, 102, 900]);
  });

  it("walks only the tree under the published pid", () => {
    const rows = collectDescendants(parseProcessTable(table), 100);
    expect(rows.map((row) => row.pid)).toEqual([100, 101, 102]);
    expect(snapshotProcesses(rows).map((process) => process.type)).toEqual(["other", "main", "renderer"]);
  });

  it("answers nothing when the published pid is gone", () => {
    expect(collectDescendants(parseProcessTable(table), 4_242)).toEqual([]);
  });
});

describe("cpuPercentBetween", () => {
  it("reports the delta over the interval as percent of one core", () => {
    const usage = cpuPercentBetween([snapshot(1, 10)], [snapshot(1, 13)], 10_000);
    expect(usage).toEqual([{ pid: 1, type: "renderer", cpuPercent: 30 }]);
  });

  it("drops a process that appeared or died inside the interval", () => {
    // 40 cumulative seconds on a renderer that opened mid-run is a lifetime
    // total, not work done during this interval. Counting it would read as a
    // spike that never happened.
    const usage = cpuPercentBetween([snapshot(1, 10)], [snapshot(1, 11), snapshot(2, 40)], 10_000);
    expect(usage.map((process) => process.pid)).toEqual([1]);
    const closed = cpuPercentBetween([snapshot(1, 10), snapshot(3, 5)], [snapshot(1, 11)], 10_000);
    expect(closed.map((process) => process.pid)).toEqual([1]);
  });

  it("drops a pid whose counter went backwards, which means it was recycled", () => {
    expect(cpuPercentBetween([snapshot(1, 10)], [snapshot(1, 2)], 10_000)).toEqual([]);
  });

  it("reports nothing rather than dividing by zero", () => {
    expect(cpuPercentBetween([snapshot(1, 10)], [snapshot(1, 13)], 0)).toEqual([]);
  });
});

describe("summarize", () => {
  it("groups the run by process kind over the full span", () => {
    const report = summarize(
      [
        { atMs: 0, processes: [snapshot(1, 0, "main"), snapshot(2, 0, "renderer")] },
        { atMs: 5_000, processes: [snapshot(1, 0.1, "main"), snapshot(2, 1.5, "renderer")] },
        { atMs: 10_000, processes: [snapshot(1, 0.2, "main"), snapshot(2, 3, "renderer")] },
      ],
      "before",
    );
    expect(report.label).toBe("before");
    expect(report.durationMs).toBe(10_000);
    expect(report.samples).toBe(3);
    expect(report.processes).toEqual([
      { type: "main", cpuPercent: 2, processes: 1 },
      { type: "renderer", cpuPercent: 30, processes: 1 },
    ]);
    expect(report.totalCpuPercent).toBe(32);
  });

  it("keeps the work of a renderer that only lived for part of the run", () => {
    const report = summarize(
      [
        { atMs: 0, processes: [snapshot(1, 0, "main")] },
        { atMs: 5_000, processes: [snapshot(1, 0, "main"), snapshot(2, 10, "renderer")] },
        { atMs: 10_000, processes: [snapshot(1, 0, "main"), snapshot(2, 12.5, "renderer")] },
      ],
      "after",
    );
    // 2.5 s of renderer work over a 10 s span, not over the 5 s it was alive.
    expect(report.processes).toContainEqual({ type: "renderer", cpuPercent: 25, processes: 1 });
  });

  it("reports an empty run rather than dividing by zero", () => {
    expect(summarize([], "empty")).toEqual({
      label: "empty",
      durationMs: 0,
      samples: 0,
      processes: [],
      totalCpuPercent: 0,
    });
    expect(summarize([{ atMs: 5, processes: [] }], "one").durationMs).toBe(0);
  });
});

describe("parseCpuReport", () => {
  const report = summarize(
    [
      { atMs: 0, processes: [snapshot(1, 0, "main")] },
      { atMs: 10_000, processes: [snapshot(1, 1, "main")] },
    ],
    "before",
  );

  it("reads back a report this tool wrote", () => {
    expect(parseCpuReport(JSON.parse(JSON.stringify(report)))).toEqual(report);
  });

  it("refuses a file that is not one, instead of comparing against undefined", () => {
    expect(parseCpuReport(null)).toBeNull();
    expect(parseCpuReport({ ...report, processes: "none" })).toBeNull();
    expect(parseCpuReport({ ...report, totalCpuPercent: "2" })).toBeNull();
    expect(parseCpuReport({ ...report, processes: [{ type: "cpu", cpuPercent: 1, processes: 1 }] })).toBeNull();
  });
});
