// The lock is the whole fix for the race that let two worktrees run on one
// port. Probing a port and then binding it seconds later is a check followed by
// a use, and the registry closes that gap only if reading it, choosing ports
// and publishing them happen one allocator at a time. So what this covers is
// that a second allocator cannot enter the critical section while a first is
// inside it - and that it reads the first one's ports when it does get in.
//
// No test here waits on the clock. The second allocator's `onWait` fires when
// it has seen the lock held, and that is the observable condition the first one
// waits for before it publishes.
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { withDevPortAllocation } from "./port-allocation";
import type { DevStackRecord } from "./stack-registry";

function stack(port: number): DevStackRecord {
  return {
    services: ["app"],
    projectRoot: "/worktrees/one",
    supervisorPid: 4_242,
    startedAt: 1_000,
    ports: [{ name: "app-renderer", port }],
    processes: [],
  };
}

describe("withDevPortAllocation", () => {
  let directory = "";
  let lockPath = "";

  beforeEach(() => {
    directory = mkdtempSync(join(tmpdir(), "openbot-port-allocation-"));
    lockPath = join(directory, "port-allocation.lock");
  });

  afterEach(() => {
    rmSync(directory, { recursive: true, force: true });
  });

  it("holds a second allocator out until the first has published its ports", async () => {
    const order: string[] = [];
    const published: DevStackRecord[] = [];
    let secondReachedTheLock = (): void => {};
    const secondHasReachedTheLock = new Promise<void>((resolveReached) => {
      secondReachedTheLock = resolveReached;
    });
    const options = { directory, readRecords: () => [...published], pollIntervalMs: 1 };

    const first = withDevPortAllocation(async (records) => {
      order.push(`first:enter(${records.length})`);
      // Resolved when the second allocator finds the lock held - or, if the
      // lock ever stops excluding it, when it walks straight in. Waiting on
      // either is what keeps this an ordering assertion rather than a race
      // between two things that happened to not overlap.
      await secondHasReachedTheLock;
      published.push(stack(5_173));
      order.push("first:publish");
    }, options);
    let seenBySecond: DevStackRecord[] = [];
    const second = withDevPortAllocation(
      async (records) => {
        order.push(`second:enter(${records.length})`);
        seenBySecond = records;
        secondReachedTheLock();
      },
      { ...options, onWait: secondReachedTheLock },
    );

    await Promise.all([first, second]);

    expect(order).toEqual(["first:enter(0)", "first:publish", "second:enter(1)"]);
    // The ports the first one won, which is what makes the second walk past
    // them instead of probing them and finding them unbound.
    expect(seenBySecond.flatMap((record) => record.ports)).toEqual([{ name: "app-renderer", port: 5_173 }]);
    expect(existsSync(lockPath)).toBe(false);
  });

  it("names the holder of the lock it is waiting for", async () => {
    const waited: number[] = [];
    let firstMayFinish = (): void => {};
    const secondIsWaiting = new Promise<void>((resolveWaiting) => {
      firstMayFinish = resolveWaiting;
    });
    const options = { directory, readRecords: (): DevStackRecord[] => [], pollIntervalMs: 1 };

    await Promise.all([
      withDevPortAllocation(() => secondIsWaiting, options),
      withDevPortAllocation(async () => {}, {
        ...options,
        onWait: (holderPid) => {
          waited.push(holderPid);
          firstMayFinish();
        },
      }),
    ]);

    expect(waited).toEqual([process.pid]);
  });

  it("breaks a lock left behind half-written", async () => {
    writeFileSync(lockPath, '{"pid": 4');
    let entered = false;

    await withDevPortAllocation(
      async () => {
        entered = true;
      },
      { directory, readRecords: () => [] },
    );

    expect(entered).toBe(true);
    expect(existsSync(lockPath)).toBe(false);
  });

  it("breaks a lock whose holder never released it", async () => {
    // This process, so liveness cannot be what lets the allocator in: the
    // holder is alive and the lock is old, which is the state left by a crash
    // between `open` and `unlink`.
    writeFileSync(lockPath, JSON.stringify({ pid: process.pid, acquiredAt: 0 }));
    let entered = false;

    await withDevPortAllocation(
      async () => {
        entered = true;
      },
      { directory, readRecords: () => [], now: () => 60_000 },
    );

    expect(entered).toBe(true);
  });

  it("releases the lock when allocation fails, instead of blocking the next attempt", async () => {
    await expect(
      withDevPortAllocation(() => Promise.reject(new Error("no available development port was found")), {
        directory,
        readRecords: () => [],
      }),
    ).rejects.toThrow("no available development port");

    expect(existsSync(lockPath)).toBe(false);
  });

  it("leaves a lock a waiter took over after deciding this one was stale", async () => {
    const usurper = JSON.stringify({ pid: process.pid, acquiredAt: 1_234 });

    await withDevPortAllocation(
      async () => {
        writeFileSync(lockPath, usurper);
      },
      { directory, readRecords: () => [] },
    );

    expect(existsSync(lockPath)).toBe(true);
    expect(readFileSync(lockPath, "utf8")).toBe(usurper);
  });
});
