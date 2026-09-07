// What a dev stack holds, so a sibling worktree never takes it.
//
// `dev-services` used to pick its ports by probing: bind 5173, and if that
// works, keep it. Nothing was written down between the probe and the moment
// Vite actually listened, which is seconds later, so two `bun run dev` calls
// started together both saw 5173 free, both claimed it, and both claimed the
// unsuffixed `OpenBot Dev` profile with it - two Electron clients writing one
// SQLite file. This registry closes that window: a stack publishes every port
// it won before it releases the allocation lock, and the next allocator reads
// those ports as taken whether or not anything is listening yet.
//
// It also records the pids, which is what `bun run dev:stop` needs. `pkill -f
// electron` is the alternative, and it kills the other worktrees too.

import { existsSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { join, resolve } from "node:path";
import { isDynamicRecord, isNumber, isOneOf, isString } from "@openbot/contracts/runtime-values";
import { devInstanceRegistryDirectory } from "./instance-registry";
import {
  assertRegistryDirectoryOwnership,
  ensureOwnerOnlyDirectory,
  isLiveRecordedProcess,
  writeRegistryFile,
} from "./registry-files";

// The union is wider than `dev-services`' own `DevelopmentService` because
// Storybook publishes here too: it is another long-running dev server on a
// default port that two worktrees would otherwise fight over.
export type DevStackService = "api" | "remote" | "app" | "test-client" | "storybook";

const DEV_STACK_SERVICES: readonly DevStackService[] = ["api", "remote", "app", "test-client", "storybook"];

export interface DevStackPort {
  // A stable label the developer reads in `dev:status`: "api", "signal",
  // "app-renderer", "app-debug", "storybook".
  name: string;
  port: number;
}

export interface DevStackProcess {
  name: DevStackService;
  pid: number;
  // Each child carries its own start time. The supervisor's would be too early
  // to separate a recycled child pid from the real one, because a child always
  // starts after the record was first written.
  startedAt: number;
}

export interface DevStackRecord {
  services: DevStackService[];
  projectRoot: string;
  supervisorPid: number;
  startedAt: number;
  ports: DevStackPort[];
  processes: DevStackProcess[];
}

// A subdirectory of the instance registry, not a sibling: one directory to
// create, one to keep owner-only, and `readDevInstanceRecords` ignores it
// because it only reads `*.json` entries.
export function devStackRegistryDirectory(): string {
  return join(devInstanceRegistryDirectory(), "stacks");
}

export function ensureDevStackRegistryDirectory(directory = devStackRegistryDirectory()): void {
  // The parent as well: an owner-only directory inside one that another
  // account can write is still theirs to replace.
  ensureOwnerOnlyDirectory(devInstanceRegistryDirectory());
  ensureOwnerOnlyDirectory(directory);
}

function stackPath(directory: string, record: Pick<DevStackRecord, "supervisorPid">): string {
  return join(directory, `stack-${record.supervisorPid}.json`);
}

function isPort(value: unknown): value is number {
  return isNumber(value) && Number.isInteger(value) && value >= 1_024 && value <= 65_535;
}

function isPid(value: unknown): value is number {
  return isNumber(value) && Number.isInteger(value) && value > 0;
}

function parseStackPort(raw: unknown): DevStackPort | null {
  if (!isDynamicRecord(raw)) return null;
  const { name, port } = raw;
  if (!isString(name) || !/^[a-z][a-z0-9-]*$/u.test(name)) return null;
  if (!isPort(port)) return null;
  return { name, port };
}

function parseStackProcess(raw: unknown): DevStackProcess | null {
  if (!isDynamicRecord(raw)) return null;
  const { name, pid, startedAt } = raw;
  if (!isOneOf(DEV_STACK_SERVICES, name)) return null;
  if (!isPid(pid)) return null;
  if (!isNumber(startedAt) || !Number.isFinite(startedAt)) return null;
  return { name, pid, startedAt };
}

function parseEach<T>(raw: unknown, parseOne: (value: unknown) => T | null): T[] | null {
  if (!Array.isArray(raw)) return null;
  const parsed: T[] = [];
  for (const value of raw) {
    const entry = parseOne(value);
    if (!entry) return null;
    parsed.push(entry);
  }
  return parsed;
}

export function parseDevStackRecord(raw: unknown): DevStackRecord | null {
  if (!isDynamicRecord(raw)) return null;
  const { services, projectRoot, supervisorPid, startedAt, ports, processes } = raw;
  const parsedServices = parseEach(services, (value) => (isOneOf(DEV_STACK_SERVICES, value) ? value : null));
  if (!parsedServices || parsedServices.length === 0) return null;
  if (!isString(projectRoot) || projectRoot === "") return null;
  if (!isPid(supervisorPid)) return null;
  if (!isNumber(startedAt) || !Number.isFinite(startedAt)) return null;
  const parsedPorts = parseEach(ports, parseStackPort);
  if (!parsedPorts) return null;
  const parsedProcesses = parseEach(processes, parseStackProcess);
  if (!parsedProcesses) return null;
  return {
    services: parsedServices,
    projectRoot,
    supervisorPid,
    startedAt,
    ports: parsedPorts,
    processes: parsedProcesses,
  };
}

export function writeDevStackRecord(record: DevStackRecord, directory = devStackRegistryDirectory()): void {
  ensureDevStackRegistryDirectory(directory);
  writeRegistryFile(stackPath(directory, record), `${JSON.stringify(record, null, 2)}\n`);
}

export function removeDevStackRecord(
  record: Pick<DevStackRecord, "supervisorPid">,
  directory = devStackRegistryDirectory(),
): void {
  rmSync(stackPath(directory, record), { force: true });
}

// A record stays live while *anything* it started is still running, not just
// while its supervisor is. That is the whole point: a `bun run dev` killed with
// SIGKILL leaves detached children holding 5173, 9333 and 3100 with nobody
// supervising them, and pruning the record then would hand those ports to the
// next worktree while they are still bound. The orphans stay visible until
// `dev:stop` clears them.
export type RecordedProcessLiveness = (entry: { pid: number; startedAt: number }) => boolean;

function supervisor(record: DevStackRecord): { pid: number; startedAt: number } {
  return { pid: record.supervisorPid, startedAt: record.startedAt };
}

export function isDevStackLive(
  record: DevStackRecord,
  isLive: RecordedProcessLiveness = isLiveRecordedProcess,
): boolean {
  return isLive(supervisor(record)) || record.processes.some((entry) => isLive(entry));
}

// The supervisor is gone and something it started is not. This is the state
// `pkill` used to be for: ports held, no runner watching, and the record is the
// only thing that still knows which pids they are.
export function isOrphanedDevStack(
  record: DevStackRecord,
  isLive: RecordedProcessLiveness = isLiveRecordedProcess,
): boolean {
  return !isLive(supervisor(record)) && record.processes.some((entry) => isLive(entry));
}

export function readDevStackRecords(
  directory = devStackRegistryDirectory(),
  isAlive: (record: DevStackRecord) => boolean = isDevStackLive,
): DevStackRecord[] {
  if (!existsSync(directory)) return [];
  // The same gate as the writer: a directory another account can write lets it
  // plant a record whose pids and ports this process would then act on -
  // skipping ports nothing holds, or signalling a pid of their choosing from
  // `dev:stop`.
  assertRegistryDirectoryOwnership(directory);
  const records: DevStackRecord[] = [];
  for (const entry of readdirSync(directory)) {
    if (!entry.endsWith(".json")) continue;
    const path = join(directory, entry);
    let record: DevStackRecord | null = null;
    try {
      record = parseDevStackRecord(JSON.parse(readFileSync(path, "utf8")));
    } catch {
      record = null;
    }
    if (record && isAlive(record)) {
      records.push(record);
      continue;
    }
    rmSync(path, { force: true });
  }
  return records.sort((left, right) => left.startedAt - right.startedAt);
}

export function heldDevStackPorts(records: DevStackRecord[]): Set<number> {
  return new Set(records.flatMap((record) => record.ports.map((entry) => entry.port)));
}

export function isSameWorktree(record: Pick<DevStackRecord, "projectRoot">, projectRoot: string): boolean {
  return resolve(record.projectRoot) === resolve(projectRoot);
}

// A second `bun run dev` in the same worktree is the mistake this catches. It
// would start a second Auth API, a second Signal service and a second Electron
// client, all of them one port along and on a differently suffixed profile, so
// the two clients disagree about which database is the worktree's and
// `dev:automation` reports the worktree as ambiguous. Another worktree's stack
// is not a conflict - that is the supported case.
//
// Overlap is by service, not by target, so `bun run dev:api` beside a running
// `bun run dev` is caught (both own the API) while `bun run storybook` beside
// either is not.
export function conflictingDevStacks(
  records: DevStackRecord[],
  query: { projectRoot: string; services: readonly DevStackService[] },
): DevStackRecord[] {
  const wanted = new Set(query.services);
  return records.filter(
    (record) => isSameWorktree(record, query.projectRoot) && record.services.some((service) => wanted.has(service)),
  );
}

export function describeDevStack(record: DevStackRecord): string {
  const ports = record.ports.map((entry) => `${entry.name}=${entry.port}`).join(" ");
  const orphaned = isOrphanedDevStack(record) ? " orphaned" : "";
  return `pid=${record.supervisorPid}${orphaned} services=${record.services.join(",")} ${ports} root=${record.projectRoot}`;
}
