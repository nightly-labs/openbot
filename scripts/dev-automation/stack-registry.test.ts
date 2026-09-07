// A stack record is what makes a port a sibling worktree will not take, and
// what `bun run dev:stop` signals instead of `pkill -f electron`. Both uses
// read pids and ports off a file in a shared temporary directory, so what this
// covers is: a planted or half-written record is refused rather than acted on,
// a record outlives the supervisor for as long as its detached children hold
// the ports, and the conflict query separates a second `bun run dev` in this
// worktree from the sibling worktrees that are supposed to run beside it.
import { spawn } from "node:child_process";
import { mkdtempSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { isProcessAlive } from "./registry-files";
import {
  conflictingDevStacks,
  type DevStackRecord,
  heldDevStackPorts,
  holdsDevStackResources,
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

  it("keeps a stack whose recorded leader is gone and whose process group still holds the ports", async () => {
    // Nothing here is fakeable, because the reason this record must survive is
    // an operating system behaviour: electron-vite exits and the Electron it
    // started keeps the renderer port, in the group the exited leader named.
    // Pruning the record there frees a port that is still bound, and the next
    // worktree takes it and fails to bind. `sh` plays the leader, `sleep` the
    // survivor.
    const leader = spawn("sh", ["-c", "sleep 30 &"], { detached: true, stdio: "ignore" });
    const pid = leader.pid ?? 0;
    await new Promise<void>((resolveExit) => leader.once("exit", () => resolveExit()));
    try {
      expect(isProcessAlive(pid)).toBe(false);
      expect(holdsDevStackResources({ pid, startedAt: Date.now() })).toBe(true);
      // A pid above the maximum on every platform this runs on, so the
      // supervisor is provably gone and the group is the only thing left.
      const record = stack({ supervisorPid: 0x3fffffff, processes: [{ name: "app", pid, startedAt: Date.now() }] });
      expect(isDevStackLive(record)).toBe(true);
    } finally {
      process.kill(-pid, "SIGKILL");
    }
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
  });

  it("leaves the file of a record it read, so a stack republished a moment later is not lost", () => {
    writeDevStackRecord(stack({ processes: [] }), directory);

    // A reader judges a copy of the record taken before the supervisor
    // published its detached child. Deleting the path on that judgement would
    // delete the version *with* the child, whose ports nothing then records.
    expect(readDevStackRecords(directory, () => false)).toEqual([]);
    expect(readdirSync(directory)).toEqual(["stack-4242.json"]);
  });

  it("ignores a record it cannot parse instead of acting on part of it", () => {
    writeFileSync(join(directory, "stack-4242.json"), '{"supervisorPid": 4242, "ports": "all of them"}');

    expect(readDevStackRecords(directory, () => true)).toEqual([]);
    // Nothing this process can parse means nothing it can act on: no port is
    // reserved and no stack is hidden, so the file is inert rather than
    // dangerous. Deleting it is what would be dangerous - a sibling worktree
    // on a newer branch writes records this checkout cannot read.
    expect(readdirSync(directory)).toEqual(["stack-4242.json"]);
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
