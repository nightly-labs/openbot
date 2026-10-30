import { INPUT_LIMITS } from "./input-limits";
import { isBoundedString, isIdentifier } from "./ipc-bounded-values";
import { type DynamicRecord, isBoolean, isDynamicRecord, isOneOf } from "./runtime-values";

/**
 * The folders that the user gave an agent besides its workspace and the shared folder. A Workspace
 * only agent can change files in them. Local-only, like `AgentSummary.access`.
 */
export const AGENT_FOLDER_LIMIT = 32;

/** Why a folder adds no access: a folder that the agent can already change holds it. */
export const AGENT_FOLDER_COVERAGE_REASONS = ["already-added", "in-workspace", "in-shared", "in-folder"] as const;
export type AgentFolderCoverageReason = (typeof AGENT_FOLDER_COVERAGE_REASONS)[number];

export interface AgentFolderCoverage {
  reason: AgentFolderCoverageReason;
  /** The folder that holds the new one. */
  folder: string;
}

/**
 * Why main refused a folder. `protected` is a folder that holds OpenBot data or other agents, the
 * home folder or a disk root. `missing` is not an existing folder.
 */
export const AGENT_FOLDER_REFUSALS = ["protected", "missing", "limit"] as const;
export type AgentFolderRefusal = (typeof AGENT_FOLDER_REFUSALS)[number];

export interface AgentFolder {
  path: string;
  /** False when the folder was moved or deleted. */
  found: boolean;
}

/**
 * The folders of one agent, with the two that it can always change. `excluded` are folders in them
 * that the agent must not change. Claude and the providers that OpenBot runs in a sandbox are blocked
 * there; Codex can only be told, because it cannot deny a folder inside a writable root.
 */
export interface AgentFolderList {
  workspace: string;
  shared: string;
  folders: AgentFolder[];
  excluded: string[];
}

export type AgentFolderChange =
  | { outcome: "cancelled"; list: AgentFolderList }
  /** `replaced`: the folders already added that the new folder holds. They are no longer in the list. */
  | { outcome: "added"; path: string; replaced: string[]; list: AgentFolderList }
  | { outcome: "replaced" | "removed"; path: string; list: AgentFolderList }
  | { outcome: "covered"; path: string; coverage: AgentFolderCoverage; list: AgentFolderList }
  | { outcome: "refused"; path: string; refusal: AgentFolderRefusal; list: AgentFolderList };

/**
 * Why main refused an excluded folder. `outside` is not in a folder the agent can change; `root` is
 * one of those folders itself.
 */
export const AGENT_EXCLUSION_REFUSALS = ["outside", "root", "missing", "limit"] as const;
export type AgentExclusionRefusal = (typeof AGENT_EXCLUSION_REFUSALS)[number];

export type AgentExclusionChange =
  | { outcome: "cancelled"; list: AgentFolderList }
  /** `replaced`: the excluded folders that the new one holds. They are no longer in the list. */
  | { outcome: "excluded"; path: string; replaced: string[]; list: AgentFolderList }
  | { outcome: "included"; path: string; list: AgentFolderList }
  /** `folder`: the excluded folder that is or holds the new one. */
  | { outcome: "covered"; path: string; folder: string; list: AgentFolderList }
  | { outcome: "refused"; path: string; refusal: AgentExclusionRefusal; list: AgentFolderList };

/** Opens the folder picker. With `replace`, the picked folder takes the place of that one (Locate…). */
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

/** Whether `path` is `root` or below it. Both are absolute and normalized. */
export function folderInside(root: string, path: string): boolean {
  if (path === root) return true;
  const trimmed = separatorAt(root, root.length - 1) ? root.slice(0, -1) : root;
  return path.startsWith(trimmed) && separatorAt(path, trimmed.length);
}

/** Whether a folder that the agent can already change holds `path`. */
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

/** The last part of a folder path, for a row title. */
export function agentFolderName(path: string): string {
  const parts = path.split(/[\\/]+/).filter(Boolean);
  return parts.at(-1) ?? path;
}

export function isAgentAdditionalFolders(value: unknown): value is string[] {
  return (
    Array.isArray(value) &&
    value.length <= AGENT_FOLDER_LIMIT &&
    value.every((path) => isBoundedString(path, INPUT_LIMITS.path) && path.length > 0)
  );
}

/** The excluded folder that is or holds `path`. */
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

function isAgentFolderList(value: unknown): value is AgentFolderList {
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

function isAgentFolderChange(value: DynamicRecord): value is AgentFolderChange & DynamicRecord {
  if (!isAgentFolderList(value.list)) return false;
  if (value.outcome === "cancelled") return true;
  if (!isBoundedString(value.path, INPUT_LIMITS.path)) return false;
  if (value.outcome === "added") return isFolderPaths(value.replaced);
  if (value.outcome === "replaced" || value.outcome === "removed") return true;
  if (value.outcome === "covered") return isCoverage(value.coverage);
  return value.outcome === "refused" && isOneOf(AGENT_FOLDER_REFUSALS, value.refusal);
}

function isAgentExclusionChange(value: DynamicRecord): value is AgentExclusionChange & DynamicRecord {
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
