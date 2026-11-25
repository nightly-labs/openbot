import { existsSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { join, resolve } from "node:path";
import { isDynamicRecord, isNumber, isOneOf, isString } from "@openbot/contracts/runtime-values";
import { devRuntimeDirectory } from "../../src/main/development-runtime-directory";
import {
  assertRegistryDirectoryOwnership,
  ensureOwnerOnlyDirectory,
  isLiveRecordedProcess,
  writeRegistryFile,
} from "./registry-files";

export type DevInstanceService = "app" | "test-client";

const DEV_INSTANCE_SERVICES: readonly DevInstanceService[] = ["app", "test-client"];

export interface DevInstanceRecord {
  service: DevInstanceService;
  instanceId: string;
  profile: string;
  projectRoot: string;
  rendererPort: number;
  remoteDebuggingPort: number;
  pid: number;
  startedAt: number;
}

export function devInstanceRegistryDirectory(): string {
  return devRuntimeDirectory();
}

function recordPath(directory: string, record: Pick<DevInstanceRecord, "pid" | "service">): string {
  return join(directory, `${record.service}-${record.pid}.json`);
}

export function parseDevInstanceRecord(raw: unknown): DevInstanceRecord | null {
  if (!isDynamicRecord(raw)) return null;
  const { service, instanceId, profile, projectRoot, rendererPort, remoteDebuggingPort, pid, startedAt } = raw;
  if (!isOneOf(DEV_INSTANCE_SERVICES, service)) return null;
  if (!isString(instanceId) || instanceId === "") return null;
  if (!isString(profile) || profile === "") return null;
  if (!isString(projectRoot) || projectRoot === "") return null;
  if (!isPort(rendererPort) || !isPort(remoteDebuggingPort)) return null;
  if (!isNumber(pid) || !Number.isInteger(pid) || pid <= 0) return null;
  if (!isNumber(startedAt) || !Number.isFinite(startedAt)) return null;
  return { service, instanceId, profile, projectRoot, rendererPort, remoteDebuggingPort, pid, startedAt };
}

function isPort(value: unknown): value is number {
  return isNumber(value) && Number.isInteger(value) && value >= 1_024 && value <= 65_535;
}

export function writeDevInstanceRecord(record: DevInstanceRecord, directory = devInstanceRegistryDirectory()): void {
  ensureOwnerOnlyDirectory(directory);
  writeRegistryFile(recordPath(directory, record), `${JSON.stringify(record, null, 2)}\n`);
}

export function removeDevInstanceRecord(
  record: Pick<DevInstanceRecord, "pid" | "service">,
  directory = devInstanceRegistryDirectory(),
): void {
  rmSync(recordPath(directory, record), { force: true });
}

export function dropReusedDebuggingPorts(records: DevInstanceRecord[]): DevInstanceRecord[] {
  const newestByPort = new Map<number, DevInstanceRecord>();
  for (const record of records) {
    const held = newestByPort.get(record.remoteDebuggingPort);
    if (!held || held.startedAt < record.startedAt) newestByPort.set(record.remoteDebuggingPort, record);
  }
  return records.filter((record) => newestByPort.get(record.remoteDebuggingPort) === record);
}

export function readDevInstanceRecords(
  directory = devInstanceRegistryDirectory(),
  isAlive: (record: DevInstanceRecord) => boolean = isLiveRecordedProcess,
): DevInstanceRecord[] {
  if (!existsSync(directory)) return [];
  assertRegistryDirectoryOwnership(directory);
  const records: DevInstanceRecord[] = [];
  for (const entry of readdirSync(directory)) {
    if (!entry.endsWith(".json")) continue;
    const path = join(directory, entry);
    let record: DevInstanceRecord | null = null;
    try {
      record = parseDevInstanceRecord(JSON.parse(readFileSync(path, "utf8")));
    } catch {
      record = null;
    }
    if (record && isAlive(record)) records.push(record);
  }
  return dropReusedDebuggingPorts(records).sort((left, right) => left.remoteDebuggingPort - right.remoteDebuggingPort);
}

export function readAllDevInstanceRecords(directory = devInstanceRegistryDirectory()): DevInstanceRecord[] {
  return readDevInstanceRecords(directory, () => true);
}

export interface DevInstanceQuery {
  projectRoot: string;
  instanceId?: string | null;
  service?: DevInstanceService;
}

export type DevInstanceMatch = "instance-id" | "worktree" | "foreign";

export type DevInstanceSelection =
  | { kind: "selected"; record: DevInstanceRecord; match: DevInstanceMatch }
  | { kind: "ambiguous"; candidates: DevInstanceRecord[] }
  | { kind: "unknown"; candidates: DevInstanceRecord[] };

export function selectDevInstance(records: DevInstanceRecord[], query: DevInstanceQuery): DevInstanceSelection {
  const service = query.service ?? "app";
  const candidates = records.filter((record) => record.service === service);
  const requested = query.instanceId?.trim();
  if (requested !== undefined && requested !== "") {
    const named = candidates.filter((record) => record.instanceId === requested);
    const [record, ...extra] = named;
    if (!record) return { kind: "unknown", candidates };
    if (extra.length > 0) return { kind: "ambiguous", candidates: named };
    return { kind: "selected", record, match: "instance-id" };
  }
  const root = resolve(query.projectRoot);
  const local = candidates.filter((record) => resolve(record.projectRoot) === root);
  const [localRecord, ...extraLocal] = local;
  if (localRecord && extraLocal.length === 0) return { kind: "selected", record: localRecord, match: "worktree" };
  if (localRecord) return { kind: "ambiguous", candidates: local };
  const [soleRecord, ...extraForeign] = candidates;
  if (soleRecord && extraForeign.length === 0) return { kind: "selected", record: soleRecord, match: "foreign" };
  if (soleRecord) return { kind: "ambiguous", candidates };
  return { kind: "unknown", candidates };
}

export function describeDevInstance(record: DevInstanceRecord): string {
  return `${record.service} :${record.remoteDebuggingPort} instance=${record.instanceId} profile="${record.profile}" root=${record.projectRoot}`;
}
