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
import { isProcessAlive } from "./registry-files";
import {
  type DevStackRecord,
  devStackRegistryDirectory,
  ensureDevStackRegistryDirectory,
  readDevStackRecords,
} from "./stack-registry";

const LOCK_FILE_NAME = "port-allocation.lock";
const LOCK_WAIT_MS = 10_000;
// A holder that has kept the lock this long is not allocating any more: it
// crashed between `open` and `unlink`, or a debugger is parked in it.
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

// A lock nobody provable holds. Each arm is a state a *correct* holder can
// never be in:
//
//   - unreadable contents. `link` publishes the lock and its holder in one
//     step, so a file at this path always parses the moment it exists. Garbage
//     is a leftover from an older runner or from a developer's `touch` - still
//     breakable, but only once it is older than the stale window, because
//     nothing else may assume a file it cannot read is abandoned.
//   - a holder that is no longer running.
//   - a holder that has kept it far longer than an allocation takes.
//
// A live holder inside the window is *not* breakable, however long this
// process has waited. Taking its lock would put two allocators in the critical
// section, which is the collision this whole file exists to stop.
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
  if (!isProcessAlive(holder.pid)) return true;
  return now - holder.acquiredAt > staleMs;
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
  const holder: LockHolder = { pid: process.pid, acquiredAt: now() };
  const deadline = now() + waitMs;
  let breakAttempts = 0;

  for (;;) {
    if (tryCreateLock(path, holder)) break;
    const current = readLockHolder(path);
    if (isBreakableLock(path, current, now(), staleMs)) {
      breakAttempts += 1;
      if (breakAttempts > MAX_BREAK_ATTEMPTS) {
        throw new Error(
          `Could not take the dev port allocation lock at ${path}. ` +
            "Check `bun run dev:status`, then remove that file if no dev stack is starting.",
        );
      }
      rmSync(path, { force: true });
      continue;
    }
    // Waited out a holder that is alive and inside its window. Something is
    // wrong with it, but it is not this process's to guess about: allocating
    // beside it would hand both of us the same ports.
    if (now() >= deadline) {
      throw new Error(
        `The dev port allocation lock at ${path} is still held by pid ${current?.pid ?? "unknown"}. ` +
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

// Only remove a lock this process still holds. A waiter that decided ours was
// stale has already replaced it, and deleting theirs would let a third
// allocator in beside them.
function releaseLock(path: string, holder: LockHolder): void {
  const current = readLockHolder(path);
  if (current !== null && (current.pid !== holder.pid || current.acquiredAt !== holder.acquiredAt)) return;
  rmSync(path, { force: true });
}
