// A stack record is what makes a port a sibling worktree will not take, and
// what `bun run dev:stop` signals instead of `pkill -f electron`. Both uses
// read pids and ports off a file in a shared temporary directory, so what this
// covers is: a planted or half-written record is refused rather than acted on,
// a record outlives the supervisor for as long as its detached children hold
// the ports, and the conflict query separates a second `bun run dev` in this
// worktree from the sibling worktrees that are supposed to run beside it.
import { mkdtempSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  conflictingDevStacks,
  type DevStackRecord,
  heldDevStackPorts,
  isDevStackLive,
  isOrphanedDevStack,
  isSameWorktree,
  parseDevStackRecord,
  readDevStackRecords,
  removeDevStackRecord,
  writeDevStackRecord,
} from "./stack-registry";

function stack(overrides: Partial<DevStackRecord> = {}): DevStackRecord {
  return {
    services: ["api", "remote", "app"],
    projectRoot: "/worktrees/one",
    supervisorPid: 4_242,
    startedAt: 1_000,
    ports: [
      { name: "api", port: 3_100 },
      { name: "signal", port: 3_101 },
      { name: "app-renderer", port: 5_173 },
    ],
    processes: [{ name: "app", pid: 4_243, startedAt: 1_100 }],
    ...overrides,
  };
}

const alive = (pids: number[]) => (entry: { pid: number }) => pids.includes(entry.pid);

describe("parseDevStackRecord", () => {
  it("keeps every field a stop command signals and an allocator skips", () => {
    expect(parseDevStackRecord(JSON.parse(JSON.stringify(stack())))).toEqual(stack());
  });

  it.each([
    ["a service nothing in the dev stack publishes", { services: ["app", "postgres"] }],
    ["no service at all", { services: [] }],
    ["a privileged port", { ports: [{ name: "api", port: 80 }] }],
    ["a port outside the range", { ports: [{ name: "api", port: 70_000 }] }],
    ["a port label that is not a label", { ports: [{ name: "../../etc", port: 3_100 }] }],
    ["a supervisor pid of zero", { supervisorPid: 0 }],
    ["a process pid that is not a pid", { processes: [{ name: "app", pid: -1, startedAt: 1_100 }] }],
    ["no start time to date a recycled pid against", { startedAt: "recently" }],
    ["no worktree to attribute it to", { projectRoot: "" }],
  ])("refuses a record naming %s", (_case, overrides) => {
    expect(parseDevStackRecord({ ...stack(), ...overrides })).toBeNull();
  });
});

describe("dev stack liveness", () => {
  it("keeps a stack live while a child it started still holds the ports", () => {
    const record = stack();

    expect(isDevStackLive(record, alive([record.processes[0].pid]))).toBe(true);
    expect(isOrphanedDevStack(record, alive([record.processes[0].pid]))).toBe(true);
  });

  it("does not call a supervised stack orphaned", () => {
    const record = stack();
    const both = alive([record.supervisorPid, record.processes[0].pid]);

    expect(isDevStackLive(record, both)).toBe(true);
    expect(isOrphanedDevStack(record, both)).toBe(false);
  });

  it("lets a stack go once nothing it recorded is running", () => {
    expect(isDevStackLive(stack(), alive([]))).toBe(false);
    expect(isOrphanedDevStack(stack(), alive([]))).toBe(false);
  });
});

describe("the stack registry directory", () => {
  let directory = "";

  beforeEach(() => {
    directory = mkdtempSync(join(tmpdir(), "openbot-stack-registry-"));
  });

  afterEach(() => {
    rmSync(directory, { recursive: true, force: true });
  });

  it("reads back what a running stack published, oldest first", () => {
    const first = stack();
    const second = stack({ supervisorPid: 4_250, startedAt: 2_000, projectRoot: "/worktrees/two" });
    writeDevStackRecord(second, directory);
    writeDevStackRecord(first, directory);

    expect(readDevStackRecords(directory, () => true)).toEqual([first, second]);

    removeDevStackRecord(first, directory);
    expect(readDevStackRecords(directory, () => true)).toEqual([second]);
  });

  it("republishes a stack in place as it learns its children", () => {
    const record = stack({ processes: [] });
    writeDevStackRecord(record, directory);
    record.processes.push({ name: "app", pid: 4_243, startedAt: 1_100 });
    writeDevStackRecord(record, directory);

    expect(readDevStackRecords(directory, () => true)).toEqual([record]);
  });

  it("drops a record no live process backs, so its ports go to the next worktree", () => {
    writeDevStackRecord(stack(), directory);

    expect(readDevStackRecords(directory, (record) => isDevStackLive(record, alive([])))).toEqual([]);
    expect(readdirSync(directory)).toEqual([]);
  });

  it("deletes a record it cannot parse instead of acting on part of it", () => {
    writeFileSync(join(directory, "stack-4242.json"), '{"supervisorPid": 4242, "ports": "all of them"}');

    expect(readDevStackRecords(directory, () => true)).toEqual([]);
    expect(readdirSync(directory)).toEqual([]);
  });
});

describe("what a new dev stack may take", () => {
  const here = stack();
  const sibling = stack({ supervisorPid: 4_250, projectRoot: "/worktrees/two", ports: [{ name: "api", port: 3_110 }] });

  it("treats every published port as taken, whether or not it is bound yet", () => {
    expect(heldDevStackPorts([here, sibling])).toEqual(new Set([3_100, 3_101, 5_173, 3_110]));
  });

  it("compares worktrees as paths, not as strings", () => {
    expect(isSameWorktree(here, "/worktrees/one/")).toBe(true);
    expect(isSameWorktree(here, "/worktrees/one/../one")).toBe(true);
    expect(isSameWorktree(here, "/worktrees/two")).toBe(false);
  });

  it("refuses a second stack owning the same service in this worktree", () => {
    expect(conflictingDevStacks([here, sibling], { projectRoot: "/worktrees/one", services: ["api"] })).toEqual([here]);
  });

  it("lets the other worktrees run, and lets Storybook run beside the servers", () => {
    expect(conflictingDevStacks([here], { projectRoot: "/worktrees/two", services: ["api", "app"] })).toEqual([]);
    expect(conflictingDevStacks([here], { projectRoot: "/worktrees/one", services: ["storybook"] })).toEqual([]);
  });
});
