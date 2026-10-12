// Failure modes: a failed build must not run old output; failed functional or visual tests must
// fail the command; filters must not weaken the release gate; Electron flags must not leak.
import { spawnSync } from "node:child_process";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { requiredVisualCases, visualCoverage } from "../tests/visual/reporter";
import { runReleaseChecks } from "./electron-e2e-release";

vi.mock("node:child_process", () => ({ spawnSync: vi.fn() }));

const spawn = vi.mocked(spawnSync);
const passed = { pid: 1, output: [], stdout: Buffer.alloc(0), stderr: Buffer.alloc(0), status: 0, signal: null };

beforeEach(() => {
  spawn.mockReset();
  spawn.mockReturnValue(passed);
});
afterEach(() => vi.unstubAllEnvs());

it("builds before functional and visual checks and removes Electron flags", () => {
  vi.stubEnv("ELECTRON_RUN_AS_NODE", "1");
  vi.stubEnv("ELECTRON_EXTRA_LAUNCH_ARGS", "--no-sandbox");
  expect(runReleaseChecks([])).toBe(0);
  expect(spawn.mock.calls.map((call) => call[1])).toEqual([
    ["run", "build"],
    ["run", "playwright", "install", "chromium"],
    ["run", "test:e2e"],
    ["run", "test:visual"],
  ]);
  for (const call of spawn.mock.calls) {
    expect(call[2]?.env?.ELECTRON_RUN_AS_NODE).toBeUndefined();
    expect(call[2]?.env?.ELECTRON_EXTRA_LAUNCH_ARGS).toBeUndefined();
    expect(call[2]?.env?.OPENBOT_E2E_SUITE).toBe("release");
  }
});

it.each([0, 1, 2, 3])("stops and returns a failure when step %i fails", (failedStep) => {
  for (let index = 0; index < failedStep; index++) spawn.mockReturnValueOnce(passed);
  spawn.mockReturnValueOnce({ ...passed, status: 7 });
  expect(runReleaseChecks([])).toBe(7);
  expect(spawn).toHaveBeenCalledTimes(failedStep + 1);
});

it("fails when a child cannot start", () => {
  spawn.mockReturnValueOnce({ ...passed, status: null, error: new Error("Spawn failed") });
  expect(runReleaseChecks([])).toBe(1);
  expect(spawn).toHaveBeenCalledTimes(1);
});

it("rejects filters and baseline updates before building", () => {
  for (const option of ["--grep=chat", "--update-snapshots", "--list"]) expect(runReleaseChecks([option])).toBe(1);
  expect(spawn).not.toHaveBeenCalled();
});

it("requires every visual case even when the remaining cases pass", () => {
  const complete = requiredVisualCases.map((id) => ({ id, status: "passed" }));
  expect(visualCoverage(complete).passed).toBe(true);
  for (const id of requiredVisualCases) {
    const coverage = visualCoverage(complete.filter((entry) => entry.id !== id));
    expect(coverage).toEqual({ passed: false, missing: [id] });
  }
  for (const status of ["skipped", "failed", "timedOut", "interrupted"])
    expect(visualCoverage(complete.map((entry, index) => (index === 0 ? { ...entry, status } : entry))).passed).toBe(
      false,
    );
});
