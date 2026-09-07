// One machine, several worktrees, one range of default dev ports. Reading the
// stack registry is not enough on its own: a stack publishes its ports only
// after it has chosen them, so two allocators running at the same moment still
// both read an empty registry. This lock makes the read-choose-publish
// sequence one at a time across every worktree on the machine.
//
// Ownership is a generation, not a path. Taking the lock means creating the
// *next* numbered file with an exclusive create, so the only step that decides
// who owns it is one the kernel makes atomic, and nothing is ever taken by
// deleting. That is the whole reason for the numbering. With a single lock
// path, recovering one whose holder has died has to `unlink`, and `unlink`
// cannot be made conditional on what the path holds: two waiters that read the
// same dead holder both delete, the first publishes a lock of its own and
// starts allocating, and the second deletes that replacement and starts
// beside it. Here the second one's create simply fails, and the judgement
// about a dead holder decides only when to move on - never who won.
//
// One rule carries that, and it is the one to keep when changing this file:
// **a lock file is removed by nothing but its own live holder, releasing it.**
// The generation an allocator asks for is the highest it saw plus one, and the
// scan and the create are separate steps that the scheduler is free to pull
// apart - so anything that removes somebody else's lock lets the numbering run
// backwards over a plan already made against it. Sweeping the litter is how
// that got in: recover the lock a dead holder left at 1, take 2, release 2,
// and an allocator arriving now finds an empty directory and takes 1, while an
// allocator that read the directory before any of it still holds a plan for 2
// and no longer collides with anybody. Both then allocate.
//
// The price is that a lock a crashed holder left behind stays there. Nothing
// reads it - the highest generation is the lock - and it is what keeps the
// numbering from ever coming back down to it. A dev start that crashes leaves
// one small file in the per-user temporary directory.
//
// The critical section is a handful of `bind` probes and one file write, so it
// is milliseconds long. Everything slow - `bun install`, electron-vite, the
// Worker runtime - happens after the lock is released.

import { closeSync, linkSync, openSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { isDynamicRecord, isNumber } from "@openbot/contracts/runtime-values";
import { verifyRecordedProcess } from "./registry-files";
import {
  type DevStackRecord,
  devStackRegistryDirectory,
  ensureDevStackRegistryDirectory,
  readDevStackRecords,
} from "./stack-registry";

const LOCK_PREFIX = "port-allocation.";
const LOCK_SUFFIX = ".lock";
const LOCK_WAIT_MS = 10_000;
// How long a file whose contents say nothing may sit in the registry before an
// allocator treats it as litter rather than as a lock.
const LOCK_STALE_MS = 30_000;
const LOCK_POLL_INTERVAL_MS = 25;

export interface DevPortAllocationOptions {
  directory?: string;
  waitMs?: number;
  staleMs?: number;
  pollIntervalMs?: number;
  now?: () => number;
  wait?: (milliseconds: number) => Promise<void>;
  readRecords?: () => DevStackRecord[];
  onWait?: (holderPid: number) => void;
}

interface LockHolder {
  pid: number;
  acquiredAt: number;
}

interface HeldLock {
  generation: number;
  path: string;
  holder: LockHolder | null;
}

function lockPath(directory: string, generation: number): string {
  return join(directory, `${LOCK_PREFIX}${generation}${LOCK_SUFFIX}`);
}

// The staging files `tryCreateLock` writes end in `.tmp`, and the stack
// records in `.json`, so neither is ever read as a lock.
function lockGeneration(fileName: string): number | null {
  if (!fileName.startsWith(LOCK_PREFIX) || !fileName.endsWith(LOCK_SUFFIX)) return null;
  const raw = fileName.slice(LOCK_PREFIX.length, fileName.length - LOCK_SUFFIX.length);
  const generation = Number(raw);
  return Number.isInteger(generation) && generation > 0 ? generation : null;
}

// The highest generation present, which is the one that owns the lock. Lower
// ones are litter that nothing reads.
function readCurrentLock(directory: string): HeldLock | null {
  let current: HeldLock | null = null;
  for (const entry of readdirSync(directory)) {
    const generation = lockGeneration(entry);
    if (generation === null || (current !== null && generation <= current.generation)) continue;
    const path = join(directory, entry);
    current = { generation, path, holder: readLockHolder(path) };
  }
  return current;
}

// How long a lock file has sat there, for the one case where its contents say
// nothing. Null when it is already gone.
function lockFileAgeMs(path: string, now: number): number | null {
  try {
    return now - statSync(path).mtimeMs;
  } catch {
    return null;
  }
}

// A lock to move past. Two states, and a *live* holder is neither of them:
//
//   - unreadable contents. `link` publishes the lock and its holder in one
//     step, so a lock file always parses the moment it exists. Garbage is a
//     leftover from an older runner or from a developer's `touch` - moved past
//     only once it is older than the stale window, because nothing may assume
//     a file it cannot read is abandoned.
//   - a holder that is no longer running. `verifyRecordedProcess` reads that
//     off the process start time, so a pid recycled since the lock was taken
//     counts as gone rather than as a live holder - which is what stops one
//     recycled pid from wedging every dev start on the machine.
//
// How long a live holder has held it does not enter into it. An allocation is
// milliseconds of work, so a lock held for a minute means something is wrong,
// but "wrong" is not "finished": the holder may be stopped in a debugger and
// about to step into the critical section. Moving past it would hand both
// allocators the same ports, which is the collision this whole file exists to
// stop, so the developer gets an error naming the pid instead. `unverified` -
// a holder this machine cannot date - is treated as live for the same reason.
function isAbandonedLock(lock: HeldLock, now: number, staleMs: number, fileAgeMs = lockFileAgeMs): boolean {
  if (lock.holder === null) {
    const age = fileAgeMs(lock.path, now);
    return age === null || age > staleMs;
  }
  return verifyRecordedProcess({ pid: lock.holder.pid, startedAt: lock.holder.acquiredAt }) === "gone";
}

function parseLockHolder(raw: unknown): LockHolder | null {
  if (!isDynamicRecord(raw)) return null;
  const { pid, acquiredAt } = raw;
  if (!isNumber(pid) || !Number.isInteger(pid) || pid <= 0) return null;
  if (!isNumber(acquiredAt) || !Number.isFinite(acquiredAt)) return null;
  return { pid, acquiredAt };
}

function readLockHolder(path: string): LockHolder | null {
  try {
    return parseLockHolder(JSON.parse(readFileSync(path, "utf8")));
  } catch {
    // Missing or garbage. Both mean nobody readable holds it, which the caller
    // weighs against how long the file has been there.
    return null;
  }
}

// Reads the whole dev registry, hands the caller the records under the lock,
// and releases it whatever the caller does. The caller is expected to publish
// its own record before returning: that is what makes the next allocator see
// these ports as taken.
export async function withDevPortAllocation<T>(
  run: (records: DevStackRecord[]) => Promise<T>,
  options: DevPortAllocationOptions = {},
): Promise<T> {
  const {
    directory = devStackRegistryDirectory(),
    waitMs = LOCK_WAIT_MS,
    staleMs = LOCK_STALE_MS,
    pollIntervalMs = LOCK_POLL_INTERVAL_MS,
    now = Date.now,
    wait = (milliseconds) => new Promise<void>((resolveWait) => setTimeout(resolveWait, milliseconds)),
    readRecords = () => readDevStackRecords(directory),
    onWait,
  } = options;
  ensureDevStackRegistryDirectory(directory);
  const holder: LockHolder = { pid: process.pid, acquiredAt: now() };
  const deadline = now() + waitMs;
  let held = "";
  let generation = 0;

  for (;;) {
    const current = readCurrentLock(directory);
    if (current === null || isAbandonedLock(current, now(), staleMs)) {
      generation = (current?.generation ?? 0) + 1;
      held = lockPath(directory, generation);
      if (tryCreateLock(held, holder)) break;
      // Another allocator created that generation between the scan and the
      // create. Exactly one of us has the lock and it is not this one, so the
      // next pass finds a live holder and waits for it.
      if (now() >= deadline) {
        throw new Error(
          `Could not take the dev port allocation lock in ${directory}: another allocator won each attempt. ` +
            "Check `bun run dev:status` and wait for those dev stacks to finish starting.",
        );
      }
      continue;
    }
    if (now() >= deadline) {
      throw new Error(
        `The dev port allocation lock at ${current.path} is still held by pid ${current.holder?.pid ?? "unknown"}. ` +
          "Check `bun run dev:status` and stop that dev stack, or wait for it to finish starting.",
      );
    }
    onWait?.(current.holder?.pid ?? 0);
    await wait(Math.min(pollIntervalMs, Math.max(deadline - now(), 1)));
  }

  try {
    return await run(readRecords());
  } finally {
    releaseLock(held, holder);
  }
}

// Somebody else holds the lock. Anything else - a read-only directory, a full
// disk - is this developer's problem to see, not something to wait out.
function isExistingPathError(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && "code" in error && error.code === "EEXIST";
}

// Fill the file first, then publish it under the lock name with `link`, which
// is atomic and fails with EEXIST when that generation is taken. Creating the
// lock with `wx` and writing to it afterwards leaves a window - short, but a
// window - where the file exists and holds nothing, and a waiter that reads it
// there sees an anonymous file and takes it for litter.
//
// Neither `open` with `wx` nor `link` follows a symlink somebody left at the
// path, so a planted link cannot redirect either half of this.
function tryCreateLock(path: string, holder: LockHolder): boolean {
  const staging = `${path}.${process.pid}.tmp`;
  rmSync(staging, { force: true });
  const handle = openSync(staging, "wx", 0o600);
  try {
    writeFileSync(handle, `${JSON.stringify(holder)}\n`, "utf8");
  } finally {
    closeSync(handle);
  }
  try {
    linkSync(staging, path);
    return true;
  } catch (error) {
    if (isExistingPathError(error)) return false;
    throw error;
  } finally {
    rmSync(staging, { force: true });
  }
}

// Only remove a lock this process still holds - the one case where removing a
// lock file is safe. An allocator that read ours as the highest generation read
// it as live, because we are running, so it waited rather than planning a
// generation above it: nothing is holding a plan that our removal could let
// back down. A file that no longer carries our identity is somebody else's, and
// deleting theirs would let a third allocator in beside them.
function releaseLock(path: string, holder: LockHolder): void {
  const current = readLockHolder(path);
  if (current !== null && (current.pid !== holder.pid || current.acquiredAt !== holder.acquiredAt)) return;
  rmSync(path, { force: true });
}
