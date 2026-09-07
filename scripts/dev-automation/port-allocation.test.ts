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
import { existsSync, mkdtempSync, readFileSync, rmSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { breakStaleLock, withDevPortAllocation } from "./port-allocation";
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
  let breakPath = "";

  beforeEach(() => {
    directory = mkdtempSync(join(tmpdir(), "openbot-port-allocation-"));
    lockPath = join(directory, "port-allocation.lock");
    breakPath = join(directory, "port-allocation.break.lock");
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

  it("waits out a lock it cannot read instead of assuming nobody holds it", async () => {
    // A file that parses as nothing is not a file nobody holds. `link`
    // publishes the lock and its contents in one step, so the only way to see
    // this is a leftover from an older runner - or a lock in the moment before
    // its holder's write lands, if a future change ever reintroduces one. Both
    // are worth waiting for; taking it would put two allocators on one port.
    writeFileSync(lockPath, '{"pid": 4');

    await expect(
      withDevPortAllocation(async () => {}, { directory, readRecords: () => [], waitMs: 0 }),
    ).rejects.toThrow("still held by pid unknown");
    expect(readFileSync(lockPath, "utf8")).toBe('{"pid": 4');
  });

  it("breaks a lock it cannot read once it has sat there past the stale window", async () => {
    writeFileSync(lockPath, '{"pid": 4');
    const longAgo = new Date(Date.now() - 60_000);
    utimesSync(lockPath, longAgo, longAgo);
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

  it("never takes the lock from a live holder, however long it has held it", async () => {
    // This process, so the holder is provably alive. An allocator that waited
    // out a live holder and then helped itself would hand both stacks the same
    // ports - a holder that is slow, or stopped in a debugger, has not
    // finished - so the developer gets the error and the pid instead. The
    // injected hour proves age is not what decides this.
    const holder = JSON.stringify({ pid: process.pid, acquiredAt: Date.now() });
    const anHourFromNow = Date.now() + 3_600_000;

    for (const clock of [Date.now, () => anHourFromNow]) {
      writeFileSync(lockPath, holder);
      await expect(
        withDevPortAllocation(async () => {}, { directory, readRecords: () => [], waitMs: 0, now: clock }),
      ).rejects.toThrow(`still held by pid ${process.pid}`);
      expect(readFileSync(lockPath, "utf8")).toBe(holder);
    }
  });

  it("breaks a lock left behind by a holder that is no longer running", async () => {
    // The state a crash between `link` and `unlink` leaves. The pid is above
    // the maximum on every platform this runs on, so nothing holds it.
    writeFileSync(lockPath, JSON.stringify({ pid: 0x3fffffff, acquiredAt: Date.now() }));
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

  it("breaks a lock whose holder pid has since been recycled", async () => {
    // This process, but claiming to have taken the lock in 1970: no process
    // alive now started before that, so this pid belongs to something else and
    // the lock is litter. Without this, one recycled pid wedges every dev
    // start on the machine until a developer removes the file by hand.
    writeFileSync(lockPath, JSON.stringify({ pid: process.pid, acquiredAt: 0 }));
    let entered = false;

    await withDevPortAllocation(
      async () => {
        entered = true;
      },
      { directory, readRecords: () => [] },
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

  // `unlink` cannot be made conditional on what the path holds, so two waiters
  // that read one dead holder would both delete: the first publishes a lock of
  // its own and starts allocating, and the second deletes that replacement and
  // starts allocating beside it. Recovery is serialized to make that
  // impossible, and these cover the two ways it declines to delete.
  describe("breakStaleLock", () => {
    it("leaves the replacement a lock it judged has already been given", () => {
      // `judge` runs under the break lock, and returns false exactly when the
      // re-read finds a live replacement instead of the dead holder.
      const replacement = JSON.stringify({ pid: process.pid, acquiredAt: Date.now() });
      writeFileSync(lockPath, replacement);

      expect(breakStaleLock(lockPath, breakPath, () => false)).toBe(false);

      expect(readFileSync(lockPath, "utf8")).toBe(replacement);
      expect(existsSync(breakPath)).toBe(false);
    });

    it("waits its turn while another allocator is recovering the same lock", () => {
      writeFileSync(breakPath, JSON.stringify({ pid: process.pid, acquiredAt: Date.now() }));
      const stale = JSON.stringify({ pid: 0x3fffffff, acquiredAt: 0 });
      writeFileSync(lockPath, stale);

      expect(breakStaleLock(lockPath, breakPath, () => true)).toBe(false);

      // Untouched: the other allocator is between deleting this file and
      // publishing its own, and deleting it here is what puts two allocators
      // on one set of ports.
      expect(readFileSync(lockPath, "utf8")).toBe(stale);
    });
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
