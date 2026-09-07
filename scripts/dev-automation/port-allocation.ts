// One machine, several worktrees, one range of default dev ports. Reading the
// stack registry is not enough on its own: a stack publishes its ports only
// after it has chosen them, so two allocators running at the same moment still
// both read an empty registry. This lock makes the read-choose-publish sequence
// one at a time across every worktree on the machine.
//
// The critical section is a handful of `bind` probes and one file write, so it
// is milliseconds long. Everything slow - `bun install`, electron-vite, the
// Worker runtime - happens after the lock is released.

import { closeSync, openSync, readFileSync, rmSync, writeFileSync } from "node:fs";
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
    const expired = current !== null && now() - current.acquiredAt > staleMs;
    if (current === null || expired || !isProcessAlive(current.pid) || now() >= deadline) {
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
    onWait?.(current.pid);
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

function tryCreateLock(path: string, holder: LockHolder): boolean {
  let handle: number;
  try {
    // `wx` is the whole mechanism: exclusive creation is atomic, and it refuses
    // to follow a symlink somebody left at the path.
    handle = openSync(path, "wx", 0o600);
  } catch (error) {
    if (isExistingPathError(error)) return false;
    throw error;
  }
  try {
    writeFileSync(handle, `${JSON.stringify(holder)}\n`, "utf8");
  } finally {
    closeSync(handle);
  }
  return true;
}

// Only remove a lock this process still holds. A waiter that decided ours was
// stale has already replaced it, and deleting theirs would let a third
// allocator in beside them.
function releaseLock(path: string, holder: LockHolder): void {
  const current = readLockHolder(path);
  if (current !== null && (current.pid !== holder.pid || current.acquiredAt !== holder.acquiredAt)) return;
  rmSync(path, { force: true });
}
