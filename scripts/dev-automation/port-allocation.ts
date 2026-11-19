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

type LockState = { kind: "held"; holder: LockHolder } | { kind: "released" } | { kind: "unreadable" };

interface HeldLock {
  generation: number;
  path: string;
  state: LockState;
}

function lockPath(directory: string, generation: number): string {
  return join(directory, `${LOCK_PREFIX}${generation}${LOCK_SUFFIX}`);
}

function lockGeneration(fileName: string): number | null {
  if (!fileName.startsWith(LOCK_PREFIX) || !fileName.endsWith(LOCK_SUFFIX)) return null;
  const generation = Number(fileName.slice(LOCK_PREFIX.length, fileName.length - LOCK_SUFFIX.length));
  return Number.isInteger(generation) && generation > 0 ? generation : null;
}

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

function lockFileAgeMs(path: string, now: number): number | null {
  try {
    return now - statSync(path).mtimeMs;
  } catch {
    return null;
  }
}

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
    return { kind: "unreadable" };
  }
  if (isDynamicRecord(raw) && raw.released === true) return { kind: "released" };
  const holder = parseLockHolder(raw);
  return holder === null ? { kind: "unreadable" } : { kind: "held", holder };
}

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

function isExistingPathError(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && "code" in error && error.code === "EEXIST";
}

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

function releaseLock(path: string, holder: LockHolder): void {
  const state = readLockState(path);
  if (state.kind === "held" && (state.holder.pid !== holder.pid || state.holder.acquiredAt !== holder.acquiredAt)) {
    return;
  }
  if (state.kind === "unreadable") return;
  const staging = `${path}.${process.pid}.release.tmp`;
  writeFileSync(staging, `${JSON.stringify({ released: true, ...holder })}\n`, { encoding: "utf8", mode: 0o600 });
  renameSync(staging, path);
}
