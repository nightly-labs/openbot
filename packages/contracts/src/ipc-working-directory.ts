import { isBoundedString, isIdentifier } from "./ipc-bounded-values";
import { isDynamicRecord } from "./runtime-values";

export interface WorkingDirectorySettings {
  workingDirectory: string | null;
  effectivePath: string;
  busy: boolean;
}
export interface SetWorkingDirectoryInput {
  agentId: string;
  path: string | null;
}
export interface BrowseWorkingDirectoryInput {
  agentId: string;
  path: string | null;
  showHidden: boolean;
  offset: number;
}
export interface HostDirectoryEntry {
  name: string;
  path: string;
}
export interface HostDirectory {
  path: string;
  parentPath: string | null;
  roots: HostDirectoryEntry[];
  entries: HostDirectoryEntry[];
  nextOffset: number | null;
}
const path = (value: unknown): value is string => isBoundedString(value, 4096) && !value.includes("\0");
const offset = (value: unknown): value is number =>
  typeof value === "number" && Number.isSafeInteger(value) && value >= 0 && value <= 100_000;
const entry = (value: unknown): value is HostDirectoryEntry =>
  isDynamicRecord(value) && isBoundedString(value.name, 1024) && path(value.path);
export function parseSetWorkingDirectory(value: unknown): SetWorkingDirectoryInput {
  if (!isDynamicRecord(value) || !isIdentifier(value.agentId) || (value.path !== null && !path(value.path)))
    throw new Error("Invalid working directory input.");
  return { agentId: value.agentId, path: value.path };
}
export function parseBrowseWorkingDirectory(value: unknown): BrowseWorkingDirectoryInput {
  const input = parseSetWorkingDirectory(value);
  if (!isDynamicRecord(value) || typeof value.showHidden !== "boolean" || !offset(value.offset))
    throw new Error("Invalid directory browse input.");
  return { ...input, showHidden: value.showHidden, offset: value.offset };
}
export function isWorkingDirectorySettings(value: unknown): value is WorkingDirectorySettings {
  return !(
    !isDynamicRecord(value) ||
    (value.workingDirectory !== null && !path(value.workingDirectory)) ||
    !path(value.effectivePath) ||
    typeof value.busy !== "boolean"
  );
}
export function decodeWorkingDirectorySettings(value: unknown): WorkingDirectorySettings {
  if (!isWorkingDirectorySettings(value)) throw new Error("Invalid working directory response.");
  return { workingDirectory: value.workingDirectory, effectivePath: value.effectivePath, busy: value.busy };
}
export function isHostDirectory(value: unknown): value is HostDirectory {
  return !(
    !isDynamicRecord(value) ||
    !path(value.path) ||
    (value.parentPath !== null && !path(value.parentPath)) ||
    !Array.isArray(value.roots) ||
    value.roots.length > 64 ||
    !value.roots.every(entry) ||
    !Array.isArray(value.entries) ||
    value.entries.length > 100 ||
    !value.entries.every(entry) ||
    (value.nextOffset !== null && !offset(value.nextOffset))
  );
}
export function decodeHostDirectory(value: unknown): HostDirectory {
  if (!isHostDirectory(value)) throw new Error("Invalid host directory response.");
  return {
    path: value.path,
    parentPath: value.parentPath,
    roots: value.roots,
    entries: value.entries,
    nextOffset: value.nextOffset,
  };
}
