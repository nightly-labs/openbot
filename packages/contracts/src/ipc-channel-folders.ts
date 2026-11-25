import { INPUT_LIMITS } from "./input-limits";
import { type AgentFolder, folderInside } from "./ipc-agent-folders";
import { isBoundedString, isIdentifier } from "./ipc-bounded-values";
import { type DynamicRecord, isBoolean, isDynamicRecord, isOneOf } from "./runtime-values";

export const CHANNEL_FOLDER_LIMIT = 8;

export const CHANNEL_FOLDER_REFUSALS = ["protected", "missing", "limit"] as const;
export type ChannelFolderRefusal = (typeof CHANNEL_FOLDER_REFUSALS)[number];

export interface ChannelFolderList {
  folders: AgentFolder[];
}

export type ChannelFolderChange =
  | { outcome: "cancelled"; list: ChannelFolderList }
  | { outcome: "added"; path: string; replaced: string[]; list: ChannelFolderList }
  | { outcome: "removed"; path: string; list: ChannelFolderList }
  | { outcome: "covered"; path: string; folder: string; list: ChannelFolderList }
  | { outcome: "refused"; path: string; refusal: ChannelFolderRefusal; list: ChannelFolderList };

export interface ChannelFolderInput {
  channelId: string;
  path: string;
}

export interface BrowseChannelFoldersInput {
  channelId: string;
  path: string | null;
}

export function isChannelFolderPaths(value: unknown): value is string[] {
  return (
    Array.isArray(value) &&
    value.length <= CHANNEL_FOLDER_LIMIT &&
    value.every((path) => isBoundedString(path, INPUT_LIMITS.path) && path.length > 0)
  );
}

export function channelFolderCoverage(path: string, folders: readonly string[]): string | null {
  return folders.find((folder) => folderInside(folder, path)) ?? null;
}

function isFolder(value: unknown): value is AgentFolder {
  return isDynamicRecord(value) && isBoundedString(value.path, INPUT_LIMITS.path) && isBoolean(value.found);
}

export function isChannelFolderList(value: unknown): value is ChannelFolderList {
  return (
    isDynamicRecord(value) &&
    Array.isArray(value.folders) &&
    value.folders.length <= CHANNEL_FOLDER_LIMIT &&
    value.folders.every(isFolder)
  );
}

export function isChannelFolderChange(value: DynamicRecord): value is ChannelFolderChange & DynamicRecord {
  if (!isChannelFolderList(value.list)) return false;
  if (value.outcome === "cancelled") return true;
  if (!isBoundedString(value.path, INPUT_LIMITS.path)) return false;
  if (value.outcome === "added")
    return (
      Array.isArray(value.replaced) &&
      value.replaced.length <= CHANNEL_FOLDER_LIMIT &&
      value.replaced.every((path) => isBoundedString(path, INPUT_LIMITS.path))
    );
  if (value.outcome === "removed") return true;
  if (value.outcome === "covered") return isBoundedString(value.folder, INPUT_LIMITS.path);
  return value.outcome === "refused" && isOneOf(CHANNEL_FOLDER_REFUSALS, value.refusal);
}

export function decodeChannelFolderListFromMain(value: unknown): ChannelFolderList {
  if (!isChannelFolderList(value)) throw new Error("Invalid channel folders.");
  return { folders: value.folders.map(({ path, found }) => ({ path, found })) };
}

export function decodeChannelFolderChangeFromMain(value: unknown): ChannelFolderChange {
  if (!isDynamicRecord(value) || !isChannelFolderChange(value)) throw new Error("Invalid channel folder change.");
  return value;
}

export function parseChannelFolderInput(value: unknown): ChannelFolderInput {
  if (
    !isDynamicRecord(value) ||
    !isIdentifier(value.channelId) ||
    !isBoundedString(value.path, INPUT_LIMITS.path) ||
    value.path.length === 0
  )
    throw new Error("Invalid channel folder input.");
  return { channelId: value.channelId, path: value.path };
}

export function parseBrowseChannelFoldersInput(value: unknown): BrowseChannelFoldersInput {
  if (
    !isDynamicRecord(value) ||
    !isIdentifier(value.channelId) ||
    !(value.path === null || (isBoundedString(value.path, INPUT_LIMITS.path) && value.path.length > 0))
  )
    throw new Error("Invalid channel folder input.");
  return { channelId: value.channelId, path: value.path };
}
