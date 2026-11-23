import { existsSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { join, resolve } from "node:path";
import { isDynamicRecord, isNumber, isOneOf, isString } from "@openbot/contracts/runtime-values";
import { devInstanceRegistryDirectory } from "./instance-registry";
import {
  assertRegistryDirectoryOwnership,
  ensureOwnerOnlyDirectory,
  isLiveRecordedProcess,
  isProcessGroupAlive,
  writeRegistryFile,
} from "./registry-files";

export type DevStackService = "api" | "remote" | "app" | "test-client" | "storybook";

const DEV_STACK_SERVICES: readonly DevStackService[] = ["api", "remote", "app", "test-client", "storybook"];

export interface DevStackPort {
  name: string;
  port: number;
}

export interface DevStackProcess {
  name: DevStackService;
  pid: number;
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

export function devStackRegistryDirectory(): string {
  return join(devInstanceRegistryDirectory(), "stacks");
}

export function ensureDevStackRegistryDirectory(directory = devStackRegistryDirectory()): void {
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

export type RecordedProcessLiveness = (entry: { pid: number; startedAt: number }) => boolean;

export function holdsDevStackResources(entry: { pid: number; startedAt: number }): boolean {
  return isLiveRecordedProcess(entry) || isProcessGroupAlive(entry.pid);
}

function supervisor(record: DevStackRecord): { pid: number; startedAt: number } {
  return { pid: record.supervisorPid, startedAt: record.startedAt };
}

export function isDevStackLive(
  record: DevStackRecord,
  isLive: RecordedProcessLiveness = holdsDevStackResources,
): boolean {
  return isLive(supervisor(record)) || record.processes.some((entry) => isLive(entry));
}

export function isOrphanedDevStack(
  record: DevStackRecord,
  isLive: RecordedProcessLiveness = holdsDevStackResources,
): boolean {
  return !isLive(supervisor(record)) && record.processes.some((entry) => isLive(entry));
}

export function readDevStackRecords(
  directory = devStackRegistryDirectory(),
  isAlive: (record: DevStackRecord) => boolean = isDevStackLive,
): DevStackRecord[] {
  if (!existsSync(directory)) return [];
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
    if (record && isAlive(record)) records.push(record);
  }
  return records.sort((left, right) => left.startedAt - right.startedAt);
}

export function readAllDevStackRecords(directory = devStackRegistryDirectory()): DevStackRecord[] {
  return readDevStackRecords(directory, () => true);
}

export function heldDevStackPorts(records: DevStackRecord[]): Set<number> {
  return new Set(records.flatMap((record) => record.ports.map((entry) => entry.port)));
}

export function isSameWorktree(record: Pick<DevStackRecord, "projectRoot">, projectRoot: string): boolean {
  return resolve(record.projectRoot) === resolve(projectRoot);
}

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
