// Serialize registry reads, port selection and publication across worktrees.
// Each acquisition atomically creates the next numbered lock with link().
// Never remove a generation path: a delayed allocator can still attempt to
// acquire that number. Release replaces its contents with a released marker.
// Only released, abandoned or stale unreadable locks can be superseded.
// Keep slow startup work outside the critical section.

import {
  closeSync,
  linkSync,
  openSync,
  readdirSync,
  readFileSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
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

// What a lock path says about itself. The path existing means only that the
// generation is spent; whether it is *held* is in the contents.
type LockState = { kind: "held"; holder: LockHolder } | { kind: "released" } | { kind: "unreadable" };

interface HeldLock {
  generation: number;
  path: string;
  state: LockState;
}

function lockPath(directory: string, generation: number): string {
  return join(directory, `${LOCK_PREFIX}${generation}${LOCK_SUFFIX}`);
}

// The staging files `tryCreateLock` and `releaseLock` write end in `.tmp`, and
// the stack records in `.json`, so neither is ever read as a lock.
function lockGeneration(fileName: string): number | null {
  if (!fileName.startsWith(LOCK_PREFIX) || !fileName.endsWith(LOCK_SUFFIX)) return null;
  const generation = Number(fileName.slice(LOCK_PREFIX.length, fileName.length - LOCK_SUFFIX.length));
  return Number.isInteger(generation) && generation > 0 ? generation : null;
}

// The highest generation present. That one decides both questions: whether the
// lock is held, and what number the next allocator may ask for. Every lower
// one is a path that exists to keep its number out of circulation.
function readCurrentLock(directory: string): HeldLock | null {
  let current: HeldLock | null = null;
  for (const entry of readdirSync(directory)) {
    const generation = lockGeneration(entry);
    if (generation === null || (current !== null && generation <= current.generation)) continue;
    const path = join(directory, entry);
    current = { generation, path, state: readLockState(path) };
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

// A live or unverifiable holder is never superseded, even after the timeout.
// Atomic publication prevents half-written locks; stale unreadable files may
// come from an older runner or manual changes.
function isAbandonedLock(lock: HeldLock, now: number, staleMs: number, fileAgeMs = lockFileAgeMs): boolean {
  if (lock.state.kind === "released") return true;
  if (lock.state.kind === "unreadable") {
    const age = fileAgeMs(lock.path, now);
    return age === null || age > staleMs;
  }
  const { pid, acquiredAt } = lock.state.holder;
  return verifyRecordedProcess({ pid, startedAt: acquiredAt }) === "gone";
}

function lockHolderPid(lock: HeldLock): number | null {
  return lock.state.kind === "held" ? lock.state.holder.pid : null;
}

function parseLockHolder(raw: unknown): LockHolder | null {
  if (!isDynamicRecord(raw)) return null;
  const { pid, acquiredAt } = raw;
  if (!isNumber(pid) || !Number.isInteger(pid) || pid <= 0) return null;
  if (!isNumber(acquiredAt) || !Number.isFinite(acquiredAt)) return null;
  return { pid, acquiredAt };
}

function readLockState(path: string): LockState {
  let raw: unknown;
  try {
    raw = JSON.parse(readFileSync(path, "utf8"));
  } catch {
    // Missing or garbage. Both mean nothing readable claims it, which the
    // caller weighs against how long the file has been there.
    return { kind: "unreadable" };
  }
  // Before the holder, because a released marker keeps the identity of whoever
  // released it and would otherwise read as a claim.
  if (isDynamicRecord(raw) && raw.released === true) return { kind: "released" };
  const holder = parseLockHolder(raw);
  return holder === null ? { kind: "unreadable" } : { kind: "held", holder };
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
        `The dev port allocation lock at ${current.path} is still held by pid ${lockHolderPid(current) ?? "unknown"}. ` +
          "Check `bun run dev:status` and stop that dev stack, or wait for it to finish starting.",
      );
    }
    onWait?.(lockHolderPid(current) ?? 0);
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

// Publish complete contents with an atomic link; EEXIST means another
// allocator owns this generation. Exclusive creation also rejects symlinks.
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

// Replace our lock contents without freeing its path for another acquisition.
// Leave a different owner's claim or unreadable contents alone.
function releaseLock(path: string, holder: LockHolder): void {
  const state = readLockState(path);
  if (state.kind === "held" && (state.holder.pid !== holder.pid || state.holder.acquiredAt !== holder.acquiredAt)) {
    return;
  }
  // Contents we cannot read are not ours either, and the path still has to
  // stay occupied, so leave it: the stale window is what recovers it.
  if (state.kind === "unreadable") return;
  const staging = `${path}.${process.pid}.release.tmp`;
  writeFileSync(staging, `${JSON.stringify({ released: true, ...holder })}\n`, { encoding: "utf8", mode: 0o600 });
  renameSync(staging, path);
}
