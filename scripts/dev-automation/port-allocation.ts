// One machine, several worktrees, one range of default dev ports. Reading the
// stack registry is not enough on its own: a stack publishes its ports only
// after it has chosen them, so two allocators running at the same moment still
// both read an empty registry. This lock makes the read-choose-publish sequence
// one at a time across every worktree on the machine.
//
// The critical section is a handful of `bind` probes and one file write, so it
// is milliseconds long. Everything slow - `bun install`, electron-vite, the
// Worker runtime - happens after the lock is released.

import { closeSync, linkSync, openSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { isDynamicRecord, isNumber } from "@openbot/contracts/runtime-values";
import { verifyRecordedProcess } from "./registry-files";
import {
  type DevStackRecord,
  devStackRegistryDirectory,
  ensureDevStackRegistryDirectory,
  readDevStackRecords,
} from "./stack-registry";

const LOCK_FILE_NAME = "port-allocation.lock";
// Recovery of a lock nobody holds happens one process at a time, behind this
// second file. See `breakStaleLock`.
const BREAK_LOCK_FILE_NAME = "port-allocation.break.lock";
const LOCK_WAIT_MS = 10_000;
// How long a file whose contents say nothing may sit at the lock path before
// an allocator treats it as litter rather than as a lock.
const LOCK_STALE_MS = 30_000;
const LOCK_POLL_INTERVAL_MS = 25;
// Breaking a lock and finding it taken again means another waiter broke it
// first. That is fine once; three times in a row is a spin, and a clear error
// beats a hang.
const MAX_BREAK_ATTEMPTS = 3;

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

// How long the lock file has sat there, for the one case where its contents
// say nothing. Null when it is already gone.
function lockFileAgeMs(path: string, now: number): number | null {
  try {
    return now - statSync(path).mtimeMs;
  } catch {
    return null;
  }
}

// A lock nobody holds. Two states, and a *live* holder is neither of them:
//
//   - unreadable contents. `link` publishes the lock and its holder in one
//     step, so a file at this path always parses the moment it exists. Garbage
//     is a leftover from an older runner or from a developer's `touch` - still
//     breakable, but only once it is older than the stale window, because
//     nothing may assume a file it cannot read is abandoned.
//   - a holder that is no longer running. `verifyRecordedProcess` reads that
//     off the process start time, so a pid recycled since the lock was taken
//     counts as gone rather than as a live holder - which is what stops a
//     recycled pid from wedging every dev start on the machine.
//
// How long a live holder has held it does not enter into it. An allocation is
// milliseconds of work, so a lock held for a minute means something is wrong,
// but "wrong" is not "finished": the holder may be stopped in a debugger and
// about to step into the critical section. Waiting it out and then taking it
// anyway would hand both allocators the same ports, which is the collision
// this whole file exists to stop, so the developer gets an error naming the
// pid instead. `unverified` - a holder this machine cannot date - is treated
// as live for the same reason.
function isBreakableLock(
  path: string,
  holder: LockHolder | null,
  now: number,
  staleMs: number,
  fileAgeMs = lockFileAgeMs,
): boolean {
  if (holder === null) {
    const age = fileAgeMs(path, now);
    return age === null || age > staleMs;
  }
  return verifyRecordedProcess({ pid: holder.pid, startedAt: holder.acquiredAt }) === "gone";
}

interface LockHolder {
  pid: number;
  acquiredAt: number;
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
    // Missing, half-written or garbage. All three mean nobody provable holds
    // it, which the caller treats as breakable.
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
  const path = join(directory, LOCK_FILE_NAME);
  const breakPath = join(directory, BREAK_LOCK_FILE_NAME);
  const holder: LockHolder = { pid: process.pid, acquiredAt: now() };
  const deadline = now() + waitMs;
  let breakAttempts = 0;
  let recoveryWasBusy = false;

  for (;;) {
    if (tryCreateLock(path, holder)) break;
    const current = readLockHolder(path);
    if (isBreakableLock(path, current, now(), staleMs)) {
      if (breakAttempts >= MAX_BREAK_ATTEMPTS) {
        throw new Error(
          `Could not take the dev port allocation lock at ${path}. ` +
            "Check `bun run dev:status`, then remove that file if no dev stack is starting.",
        );
      }
      const broken = breakStaleLock(path, breakPath, () => isBreakableLock(path, readLockHolder(path), now(), staleMs));
      recoveryWasBusy = !broken;
      if (broken) {
        breakAttempts += 1;
        continue;
      }
      // Another allocator is recovering this lock. Look again rather than
      // reach past it - it is about to publish a lock of its own.
    }
    if (now() >= deadline) {
      throw new Error(
        recoveryWasBusy
          ? `The dev port allocation lock at ${path} was left behind by pid ${current?.pid ?? "unknown"}, ` +
              `and the allocator recovering it did not finish. Remove ${breakPath} if no dev stack is starting.`
          : `The dev port allocation lock at ${path} is still held by pid ${current?.pid ?? "unknown"}. ` +
              "Check `bun run dev:status` and stop that dev stack, or wait for it to finish starting.",
      );
    }
    onWait?.(current?.pid ?? 0);
    await wait(Math.min(pollIntervalMs, Math.max(deadline - now(), 1)));
  }

  try {
    return await run(readRecords());
  } finally {
    releaseLock(path, holder);
  }
}

// Somebody else holds the lock. Anything else - a read-only directory, a full
// disk - is this developer's problem to see, not something to wait out.
function isExistingPathError(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && "code" in error && error.code === "EEXIST";
}

// Fill the file first, then publish it under the lock name with `link`, which
// is atomic and fails with EEXIST when the lock is taken. Creating the lock
// with `wx` and writing to it afterwards leaves a window - short, but a window
// - where the path exists and holds nothing, and a waiter that reads it there
// sees an anonymous file and takes it for an abandoned one. Both allocators
// then proceed, which is the same collision as having no lock at all.
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

// Removing the lock is the one step that touches a file another allocator may
// own by the time it runs, and `unlink` cannot be made conditional on what the
// path holds: two waiters that read the same dead holder both delete, the
// first publishes a lock of its own and enters allocation, and the second
// deletes *that* one and enters beside it. Both then get the same ports, which
// is the failure the lock exists to prevent. So recovery is serialized behind
// a second file: whoever takes it reads the lock again through `judge` and
// finds the replacement rather than the dead holder it saw a moment ago.
//
// Nothing ever breaks this second file. It is held across a handful of
// syscalls with no `await` between them, so only a hard kill inside that
// window can leak it, and a leak costs recovery rather than correctness -
// allocators wait and then fail with a message naming the file. Recovering it
// automatically would need the same serialization one level down.
export function breakStaleLock(path: string, breakPath: string, judge: () => boolean): boolean {
  if (!tryCreateLock(breakPath, { pid: process.pid, acquiredAt: Date.now() })) return false;
  try {
    if (!judge()) return false;
    rmSync(path, { force: true });
    return true;
  } finally {
    rmSync(breakPath, { force: true });
  }
}

// Only remove a lock this process still holds. A waiter that decided ours was
// stale has already replaced it, and deleting theirs would let a third
// allocator in beside them.
function releaseLock(path: string, holder: LockHolder): void {
  const current = readLockHolder(path);
  if (current !== null && (current.pid !== holder.pid || current.acquiredAt !== holder.acquiredAt)) return;
  rmSync(path, { force: true });
}
