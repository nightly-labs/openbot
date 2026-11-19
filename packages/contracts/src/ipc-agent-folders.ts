import { INPUT_LIMITS } from "./input-limits";
import { isBoundedString, isIdentifier } from "./ipc-bounded-values";
import { type DynamicRecord, isBoolean, isDynamicRecord, isOneOf } from "./runtime-values";

export const AGENT_FOLDER_LIMIT = 32;

export const AGENT_FOLDER_COVERAGE_REASONS = ["already-added", "in-workspace", "in-shared", "in-folder"] as const;
export type AgentFolderCoverageReason = (typeof AGENT_FOLDER_COVERAGE_REASONS)[number];

export interface AgentFolderCoverage {
  reason: AgentFolderCoverageReason;
  folder: string;
}

export const AGENT_FOLDER_REFUSALS = ["protected", "missing", "limit"] as const;
export type AgentFolderRefusal = (typeof AGENT_FOLDER_REFUSALS)[number];

export interface AgentFolder {
  path: string;
  found: boolean;
}

export interface AgentFolderList {
  workspace: string;
  shared: string;
  folders: AgentFolder[];
  excluded: string[];
}

export type AgentFolderChange =
  | { outcome: "cancelled"; list: AgentFolderList }
  | { outcome: "added"; path: string; replaced: string[]; list: AgentFolderList }
  | { outcome: "replaced" | "removed"; path: string; list: AgentFolderList }
  | { outcome: "covered"; path: string; coverage: AgentFolderCoverage; list: AgentFolderList }
  | { outcome: "refused"; path: string; refusal: AgentFolderRefusal; list: AgentFolderList };

export const AGENT_EXCLUSION_REFUSALS = ["outside", "root", "missing", "limit"] as const;
export type AgentExclusionRefusal = (typeof AGENT_EXCLUSION_REFUSALS)[number];

export type AgentExclusionChange =
  | { outcome: "cancelled"; list: AgentFolderList }
  | { outcome: "excluded"; path: string; replaced: string[]; list: AgentFolderList }
  | { outcome: "included"; path: string; list: AgentFolderList }
  | { outcome: "covered"; path: string; folder: string; list: AgentFolderList }
  | { outcome: "refused"; path: string; refusal: AgentExclusionRefusal; list: AgentFolderList };

export interface ChooseAgentFolderInput {
  agentId: string;
  replace?: string;
}

export interface AgentFolderInput {
  agentId: string;
  path: string;
}

function separatorAt(path: string, index: number): boolean {
  return path[index] === "/" || path[index] === "\\";
}

export function folderInside(root: string, path: string): boolean {
  if (path === root) return true;
  const trimmed = separatorAt(root, root.length - 1) ? root.slice(0, -1) : root;
  return path.startsWith(trimmed) && separatorAt(path, trimmed.length);
}

export function agentFolderCoverage(
  path: string,
  roots: { workspace: string; shared: string; folders: readonly string[] },
): AgentFolderCoverage | null {
  if (roots.folders.includes(path)) return { reason: "already-added", folder: path };
  if (folderInside(roots.workspace, path)) return { reason: "in-workspace", folder: roots.workspace };
  if (folderInside(roots.shared, path)) return { reason: "in-shared", folder: roots.shared };
  const parent = roots.folders.find((folder) => folderInside(folder, path));
  return parent === undefined ? null : { reason: "in-folder", folder: parent };
}

export function agentFolderName(path: string): string {
  const parts = path.split(/[\\/]+/).filter(Boolean);
  return parts.at(-1) ?? path;
}

export function agentFolderParent(path: string): string {
  const end = Math.max(path.lastIndexOf("/"), path.lastIndexOf("\\"));
  if (end === 0) return path.slice(0, 1);
  return end > 0 ? path.slice(0, end) : path;
}

export function agentExclusionPlace(
  path: string,
  list: AgentFolderList,
  names: { workspace: string; shared: string },
): string | null {
  const holders: [string, string][] = [
    [list.workspace, names.workspace],
    [list.shared, names.shared],
    ...list.folders.map((folder): [string, string] => [folder.path, agentFolderName(folder.path)]),
  ];
  const holder = holders.find(([root]) => folderInside(root, path));
  if (!holder) return null;
  const below = agentFolderParent(path)
    .slice(holder[0].length)
    .replace(/^[/\\]+/, "");
  return below ? `${holder[1]}/${below}` : holder[1];
}

export function isAgentAdditionalFolders(value: unknown): value is string[] {
  return (
    Array.isArray(value) &&
    value.length <= AGENT_FOLDER_LIMIT &&
    value.every((path) => isBoundedString(path, INPUT_LIMITS.path) && path.length > 0)
  );
}

export function agentExclusionCoverage(path: string, excluded: readonly string[]): string | null {
  return excluded.find((folder) => folderInside(folder, path)) ?? null;
}

function isFolderPaths(value: unknown): value is string[] {
  return (
    Array.isArray(value) &&
    value.length <= AGENT_FOLDER_LIMIT &&
    value.every((path) => isBoundedString(path, INPUT_LIMITS.path))
  );
}

function isAgentFolder(value: unknown): value is AgentFolder {
  return isDynamicRecord(value) && isBoundedString(value.path, INPUT_LIMITS.path) && isBoolean(value.found);
}

export function isAgentFolderList(value: unknown): value is AgentFolderList {
  return (
    isDynamicRecord(value) &&
    isBoundedString(value.workspace, INPUT_LIMITS.path) &&
    isBoundedString(value.shared, INPUT_LIMITS.path) &&
    Array.isArray(value.folders) &&
    value.folders.length <= AGENT_FOLDER_LIMIT &&
    value.folders.every(isAgentFolder) &&
    isFolderPaths(value.excluded)
  );
}

function isCoverage(value: unknown): value is AgentFolderCoverage {
  return (
    isDynamicRecord(value) &&
    isOneOf(AGENT_FOLDER_COVERAGE_REASONS, value.reason) &&
    isBoundedString(value.folder, INPUT_LIMITS.path)
  );
}

export function isAgentFolderChange(value: DynamicRecord): value is AgentFolderChange & DynamicRecord {
  if (!isAgentFolderList(value.list)) return false;
  if (value.outcome === "cancelled") return true;
  if (!isBoundedString(value.path, INPUT_LIMITS.path)) return false;
  if (value.outcome === "added") return isFolderPaths(value.replaced);
  if (value.outcome === "replaced" || value.outcome === "removed") return true;
  if (value.outcome === "covered") return isCoverage(value.coverage);
  return value.outcome === "refused" && isOneOf(AGENT_FOLDER_REFUSALS, value.refusal);
}

export function isAgentExclusionChange(value: DynamicRecord): value is AgentExclusionChange & DynamicRecord {
  if (!isAgentFolderList(value.list)) return false;
  if (value.outcome === "cancelled") return true;
  if (!isBoundedString(value.path, INPUT_LIMITS.path)) return false;
  if (value.outcome === "excluded") return isFolderPaths(value.replaced);
  if (value.outcome === "included") return true;
  if (value.outcome === "covered") return isBoundedString(value.folder, INPUT_LIMITS.path);
  return value.outcome === "refused" && isOneOf(AGENT_EXCLUSION_REFUSALS, value.refusal);
}

export function decodeAgentFolderListFromMain(value: unknown): AgentFolderList {
  if (!isAgentFolderList(value)) throw new Error("Invalid agent folders.");
  return value;
}

export function decodeAgentFolderChangeFromMain(value: unknown): AgentFolderChange {
  if (!isDynamicRecord(value) || !isAgentFolderChange(value)) throw new Error("Invalid agent folder change.");
  return value;
}

export function decodeAgentExclusionChangeFromMain(value: unknown): AgentExclusionChange {
  if (!isDynamicRecord(value) || !isAgentExclusionChange(value)) throw new Error("Invalid agent folder change.");
  return value;
}

export function parseChooseAgentFolderInput(value: unknown): ChooseAgentFolderInput {
  if (!isDynamicRecord(value) || !isIdentifier(value.agentId)) throw new Error("Invalid agent folder input.");
  if (value.replace === undefined) return { agentId: value.agentId };
  if (!isBoundedString(value.replace, INPUT_LIMITS.path)) throw new Error("Invalid agent folder input.");
  return { agentId: value.agentId, replace: value.replace };
}

export function parseAgentFolderInput(value: unknown): AgentFolderInput {
  if (!isDynamicRecord(value) || !isIdentifier(value.agentId) || !isBoundedString(value.path, INPUT_LIMITS.path))
    throw new Error("Invalid agent folder input.");
  if (value.path.length === 0) throw new Error("Invalid agent folder input.");
  return { agentId: value.agentId, path: value.path };
}

export const AGENT_FOLDER_BROWSE_LIMIT = 500;

export interface AgentFolderBrowseEntry {
  name: string;
  path: string;
}

export interface AgentFolderBrowse {
  path: string;
  parentPath: string | null;
  entries: AgentFolderBrowseEntry[];
  truncated: boolean;
  home: string;
  volumes: AgentFolderBrowseEntry[];
}

export const AGENT_FOLDER_VOLUME_LIMIT = 32;

export interface BrowseAgentFoldersInput {
  agentId: string;
  path: string | null;
}

export interface AddAgentFolderInput extends AgentFolderInput {
  replace?: string;
}

function isAgentFolderBrowseEntry(value: unknown): value is AgentFolderBrowseEntry {
  return (
    isDynamicRecord(value) &&
    isBoundedString(value.name, INPUT_LIMITS.path) &&
    isBoundedString(value.path, INPUT_LIMITS.path)
  );
}

export function isAgentFolderBrowse(value: unknown): value is AgentFolderBrowse {
  return (
    isDynamicRecord(value) &&
    isBoundedString(value.path, INPUT_LIMITS.path) &&
    (value.parentPath === null || isBoundedString(value.parentPath, INPUT_LIMITS.path)) &&
    Array.isArray(value.entries) &&
    value.entries.length <= AGENT_FOLDER_BROWSE_LIMIT &&
    value.entries.every(isAgentFolderBrowseEntry) &&
    isBoolean(value.truncated) &&
    isBoundedString(value.home, INPUT_LIMITS.path) &&
    Array.isArray(value.volumes) &&
    value.volumes.length <= AGENT_FOLDER_VOLUME_LIMIT &&
    value.volumes.every(isAgentFolderBrowseEntry)
  );
}

export function decodeAgentFolderBrowse(value: unknown): AgentFolderBrowse {
  if (!isAgentFolderBrowse(value)) throw new Error("Invalid agent folder browse.");
  return {
    path: value.path,
    parentPath: value.parentPath,
    entries: value.entries,
    truncated: value.truncated,
    home: value.home,
    volumes: value.volumes,
  };
}

export function parseBrowseAgentFoldersInput(value: unknown): BrowseAgentFoldersInput {
  if (
    !isDynamicRecord(value) ||
    !isIdentifier(value.agentId) ||
    !(value.path === null || (isBoundedString(value.path, INPUT_LIMITS.path) && value.path.length > 0))
  )
    throw new Error("Invalid agent folder input.");
  return { agentId: value.agentId, path: value.path };
}

export function parseAddAgentFolderInput(value: unknown): AddAgentFolderInput {
  const input = parseAgentFolderInput(value);
  if (!isDynamicRecord(value) || value.replace === undefined) return input;
  if (!isBoundedString(value.replace, INPUT_LIMITS.path)) throw new Error("Invalid agent folder input.");
  return { ...input, replace: value.replace };
}
