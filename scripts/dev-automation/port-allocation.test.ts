// The lock is the whole fix for the race that let two worktrees run on one
// port. Probing a port and then binding it seconds later is a check followed
// by a use, and the registry closes that gap only if reading it, choosing
// ports and publishing them happen one allocator at a time. So what this
// covers is that a second allocator cannot enter the critical section while a
// first is inside it - including when the first one arrived by superseding a
// lock they both judged abandoned - and that it reads the first one's ports
// when it does get in.
//
// No test here waits on the clock. The second allocator's `onWait` fires when
// it has seen the lock held, and that is the observable condition the first
// one waits for before it publishes.
import { spawn } from "node:child_process";
import { mkdtempSync, readdirSync, readFileSync, rmSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
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

// A pid above the maximum on every platform this runs on, so nothing holds it.
const NOBODY = 0x3fffffff;

const here = dirname(fileURLToPath(import.meta.url));

describe("withDevPortAllocation", () => {
  let directory = "";

  beforeEach(() => {
    directory = mkdtempSync(join(tmpdir(), "openbot-port-allocation-"));
  });

  afterEach(() => {
    rmSync(directory, { recursive: true, force: true });
  });

  // Sorted, because these assert which generations exist rather than the order
  // the filesystem lists them in.
  const heldLocks = (): string[] =>
    readdirSync(directory)
      .filter((entry) => entry.endsWith(".lock"))
      .sort();
  const spentLocks = (): string[] =>
    readdirSync(directory)
      .filter((entry) => entry.endsWith(".released"))
      .sort();
  const plantLock = (generation: number, contents: string): string => {
    const path = join(directory, `port-allocation.${generation}.lock`);
    writeFileSync(path, contents);
    return path;
  };

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
    expect(heldLocks()).toEqual([]);
  });

  it("lets only one of several processes allocate at a time, even with an abandoned lock to recover", async () => {
    // The one case in-process tests cannot reach. Everything from reading the
    // registry to publishing the lock is synchronous, so two allocators in this
    // process never interleave there - and that gap is exactly where the
    // dangerous interleaving lives: several allocators reading the same
    // abandoned lock at once, each deciding to recover it. Real processes are
    // the only way to put them inside that window together, so this spawns
    // them.
    //
    // Every child starts against a lock left by a dead holder, so each one has
    // to recover before it can allocate. Whoever recovers must end up with
    // exclusive use; the others must wait for them. The hold inside the
    // critical section widens the window a broken lock would overlap in - it
    // is not what makes a correct one pass, and no assertion here waits on the
    // clock: the barrier is the children exiting.
    plantLock(1, JSON.stringify({ pid: NOBODY, acquiredAt: 1 }));
    const log = join(directory, "sections.log");
    const child = join(directory, "allocate.ts");
    writeFileSync(
      child,
      `import { appendFileSync } from "node:fs";
       const { withDevPortAllocation } = await import(${JSON.stringify(join(here, "port-allocation.ts"))});
       await withDevPortAllocation(async () => {
         appendFileSync(${JSON.stringify(log)}, \`enter \${process.pid}\\n\`);
         await new Promise((done) => setTimeout(done, 25));
         appendFileSync(${JSON.stringify(log)}, \`leave \${process.pid}\\n\`);
       }, { directory: ${JSON.stringify(directory)}, readRecords: () => [] });`,
    );

    const exits = await Promise.all(
      Array.from({ length: 4 }, () => {
        const process_ = spawn("bun", [child], { stdio: ["ignore", "ignore", "pipe"] });
        let stderr = "";
        process_.stderr.on("data", (chunk) => {
          stderr += String(chunk);
        });
        return new Promise<string>((resolveExit) => {
          process_.once("exit", (code) => resolveExit(code === 0 ? "" : stderr || `exit ${code}`));
        });
      }),
    );

    expect(exits).toEqual(["", "", "", ""]);
    // Strictly alternating enter/leave. Two allocators inside together read the
    // same registry and hand their stacks the same ports, which reads here as
    // an "enter" before the previous "leave".
    const sections = readFileSync(log, "utf8").trimEnd().split("\n");
    // Joined, so a failure prints the order it actually got.
    expect(sections.map((line) => line.split(" ")[0]).join(" ")).toBe(
      "enter leave enter leave enter leave enter leave",
    );
    expect(new Set(sections.map((line) => line.split(" ")[1])).size).toBe(4);
    // Every lock these four took is released, and the abandoned one they all
    // recovered from is still there. See the supersede test below.
    expect(heldLocks()).toEqual(["port-allocation.1.lock"]);
  }, 30_000);

  it("never hands the same generation out twice", async () => {
    // Releasing gives up the claim, not the number. A generation handed out
    // again is the whole failure this scheme has to prevent: an allocator's
    // scan, its read of the highest lock and its create are separate steps, so
    // one of them can be holding a plan for generation 2 while a later arrival
    // is handed a freed generation 1 - and once they are on different numbers,
    // the exclusive create no longer makes them collide and both allocate. So
    // a released lock keeps its file, under a name that no longer claims the
    // lock, and each allocation gets the number above it.
    const taken: string[] = [];
    for (let attempt = 0; attempt < 3; attempt += 1) {
      await withDevPortAllocation(
        async () => {
          taken.push(...heldLocks());
        },
        { directory, readRecords: () => [] },
      );
    }

    expect(taken).toEqual(["port-allocation.1.lock", "port-allocation.2.lock", "port-allocation.3.lock"]);
    expect(heldLocks()).toEqual([]);
    expect(spentLocks()).toEqual([
      "port-allocation.1.released",
      "port-allocation.2.released",
      "port-allocation.3.released",
    ]);
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
    // are worth waiting for.
    const path = plantLock(1, '{"pid": 4');

    await expect(
      withDevPortAllocation(async () => {}, { directory, readRecords: () => [], waitMs: 0 }),
    ).rejects.toThrow("still held by pid unknown");
    expect(readFileSync(path, "utf8")).toBe('{"pid": 4');
  });

  it("moves past a lock it cannot read once it has sat there past the stale window", async () => {
    const path = plantLock(1, '{"pid": 4');
    const longAgo = new Date(Date.now() - 60_000);
    utimesSync(path, longAgo, longAgo);
    let entered = false;

    await withDevPortAllocation(
      async () => {
        entered = true;
      },
      { directory, readRecords: () => [] },
    );

    expect(entered).toBe(true);
    expect(heldLocks()).toEqual(["port-allocation.1.lock"]);
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
      const path = plantLock(1, holder);
      await expect(
        withDevPortAllocation(async () => {}, { directory, readRecords: () => [], waitMs: 0, now: clock }),
      ).rejects.toThrow(`still held by pid ${process.pid}`);
      expect(readFileSync(path, "utf8")).toBe(holder);
    }
  });

  it("supersedes a lock left behind by a holder that is no longer running, and leaves it in place", async () => {
    // The state a crash between `link` and `unlink` leaves - and the rule the
    // whole scheme rests on: an allocator adds its own lock and removes
    // nothing else, so a lock file only ever goes away under its own live
    // holder. Tidying the recovered one away instead is what let the numbering
    // run backwards: recover 1, take 2, release 2, and the next allocator
    // finds an empty directory and takes 1 - beside an allocator that read the
    // directory earlier, planned 2, and now collides with nobody.
    plantLock(1, JSON.stringify({ pid: NOBODY, acquiredAt: Date.now() }));
    let entered = false;

    await withDevPortAllocation(
      async () => {
        entered = true;
        expect(heldLocks()).toEqual(["port-allocation.1.lock", "port-allocation.2.lock"]);
      },
      { directory, readRecords: () => [] },
    );

    expect(entered).toBe(true);
    // The recovered lock still standing and ours released, so neither number
    // is ever handed out again.
    expect(heldLocks()).toEqual(["port-allocation.1.lock"]);
    expect(spentLocks()).toEqual(["port-allocation.2.released"]);
  });

  it("supersedes a lock whose holder pid has since been recycled", async () => {
    // This process, but claiming to have taken the lock in 1970: no process
    // alive now started before that, so this pid belongs to something else and
    // the lock is litter. Without this, one recycled pid wedges every dev
    // start on the machine until a developer removes the file by hand.
    plantLock(1, JSON.stringify({ pid: process.pid, acquiredAt: 0 }));
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

    expect(heldLocks()).toEqual([]);
    // Released rather than left claimed, so the next attempt is not blocked -
    // and at generation 2, because generation 1 is spent.
    let second = "";
    await withDevPortAllocation(
      async () => {
        second = heldLocks().join();
      },
      { directory, readRecords: () => [], waitMs: 0 },
    );
    expect(second).toBe("port-allocation.2.lock");
  });

  it("leaves a lock a waiter took over after deciding this one was abandoned", async () => {
    const usurper = JSON.stringify({ pid: process.pid, acquiredAt: 1_234 });

    await withDevPortAllocation(
      async () => {
        writeFileSync(join(directory, "port-allocation.1.lock"), usurper);
      },
      { directory, readRecords: () => [] },
    );

    expect(readFileSync(join(directory, "port-allocation.1.lock"), "utf8")).toBe(usurper);
  });
});
