/*
 * Display helpers for the Files and storage views (issue #496). The row and usage shapes are the IPC
 * contract in `@openbot/contracts/ipc`; labels, grouping and filters stay here, beside the views.
 */

import type { StorageBreakdown, StorageCategory, StoredFileRow } from "@openbot/contracts/ipc";
import type { AppFormat, AppTextKey, AppTranslate } from "@openbot/i18n";
import type { FileSort, FileTypeFilter } from "@openbot/team-client/stored-files";

export type {
  AgentStorageRow,
  ConversationStorageRow,
  StorageBreakdown,
  StorageCategory,
  StorageUsage,
  StoredFileConversation,
  StoredFileRow,
  StoredFileSource,
  StoredFileStatus,
} from "@openbot/contracts/ipc";

export type StoredFileAction = "open" | "reveal" | "download" | "show-in-chat" | "delete" | "retry";

export const STORAGE_CATEGORY_LABELS = {
  workspaces: "files.category.workspaces",
  attachments: "files.category.attachments",
  generated: "files.category.generated",
  chats: "files.category.chats",
  downloads: "files.category.downloads",
  caches: "files.category.caches",
  runtimes: "files.category.runtimes",
  logs: "files.category.logs",
} as const satisfies Record<StorageCategory, AppTextKey>;

/**
 * The bar shows six groups, not eight categories: past five hues a stacked bar stops being
 * readable, so caches and logs fold into one neutral "App data" segment. Provider runtimes keep a
 * hue of their own: they are usually the largest share, and "App data" told the user nothing.
 */
export type StorageGroup = "workspaces" | "files" | "chats" | "downloads" | "runtimes" | "app";

export const STORAGE_GROUPS: readonly StorageGroup[] = ["workspaces", "files", "chats", "downloads", "runtimes", "app"];

export const STORAGE_GROUP_LABELS = {
  workspaces: "files.group.workspaces",
  files: "files.group.files",
  chats: "files.group.chats",
  downloads: "files.group.downloads",
  runtimes: "files.category.runtimes",
  app: "files.group.app",
} as const satisfies Record<StorageGroup, AppTextKey>;

const STORAGE_GROUP_OF: Record<StorageCategory, StorageGroup> = {
  workspaces: "workspaces",
  attachments: "files",
  generated: "files",
  chats: "chats",
  downloads: "downloads",
  caches: "app",
  runtimes: "runtimes",
  logs: "app",
};

export interface StorageGroupTotal {
  group: StorageGroup;
  label: string;
  bytes: number;
  percent: number;
}

/** Groups in fixed order, so a group keeps its colour when another one is empty. Empty groups are left out. */
export function storageGroupTotals(breakdown: readonly StorageBreakdown[], t: AppTranslate): StorageGroupTotal[] {
  const total = storageTotal(breakdown);
  return STORAGE_GROUPS.map((group) => {
    const bytes = breakdown
      .filter((entry) => STORAGE_GROUP_OF[entry.category] === group)
      .reduce((sum, entry) => sum + entry.bytes, 0);
    return { group, label: t(STORAGE_GROUP_LABELS[group]), bytes, percent: sharePercent(bytes, total) };
  }).filter((entry) => entry.bytes > 0);
}

export function storageTotal(breakdown: readonly StorageBreakdown[]): number {
  return breakdown.reduce((sum, entry) => sum + entry.bytes, 0);
}

export function storageBytes(breakdown: readonly StorageBreakdown[], category: StorageCategory): number {
  return breakdown.find((entry) => entry.category === category)?.bytes ?? 0;
}

/** Share of the total as a percent. A non-zero share never rounds to 0, so a small segment stays visible in the legend. */
export function sharePercent(bytes: number, total: number): number {
  if (total <= 0 || bytes <= 0) return 0;
  const percent = (bytes / total) * 100;
  return percent < 1 ? Math.max(0.1, Math.round(percent * 10) / 10) : Math.round(percent);
}

export {
  type FileQuery,
  type FileSort,
  type FileType,
  type FileTypeFilter,
  fileTypeCounts,
  fileTypeOf,
  queryFiles,
} from "@openbot/team-client/stored-files";

export const FILE_TYPE_FILTERS: ReadonlyArray<{ value: FileTypeFilter; label: AppTextKey }> = [
  { value: "all", label: "files.type.all" },
  { value: "images", label: "files.type.images" },
  { value: "documents", label: "files.type.documents" },
  { value: "code", label: "files.type.code" },
  { value: "spreadsheets", label: "files.type.spreadsheets" },
  { value: "media", label: "files.type.media" },
  { value: "other", label: "files.type.other" },
];

export const FILE_SORTS: ReadonlyArray<{ value: FileSort; label: AppTextKey }> = [
  { value: "newest", label: "files.sort.newest" },
  { value: "largest", label: "files.sort.largest" },
  { value: "name", label: "files.sort.name" },
];

function startOfDay(value: Date): number {
  return new Date(value.getFullYear(), value.getMonth(), value.getDate()).getTime();
}

/** "Today", "Yesterday", or a short date. `now` is a parameter so a story does not depend on the day it runs. */
export function fileDayLabel(iso: string, now: Date, t: AppTranslate, format: AppFormat): string {
  const date = new Date(iso);
  const days = Math.round((startOfDay(now) - startOfDay(date)) / 86_400_000);
  if (days === 0) return t("files.day.today");
  if (days === 1) return t("files.day.yesterday");
  return format.date(date, {
    month: "short",
    day: "numeric",
    year: date.getFullYear() === now.getFullYear() ? undefined : "numeric",
  });
}

export interface FileGroup {
  key: string;
  label: string;
  files: StoredFileRow[];
}

/** Consecutive files that share a day, in the order the caller sorted them. */
export function groupFilesByDay(
  files: readonly StoredFileRow[],
  now: Date,
  t: AppTranslate,
  format: AppFormat,
): FileGroup[] {
  const groups: FileGroup[] = [];
  for (const file of files) {
    const label = fileDayLabel(file.createdAt, now, t, format);
    const last = groups.at(-1);
    if (last?.label === label) last.files.push(file);
    else groups.push({ key: `${label}-${groups.length}`, label, files: [file] });
  }
  return groups;
}

export function fileCountLabel(count: number, t: AppTranslate): string {
  return t("files.count", { count });
}

export function chatCountLabel(count: number, t: AppTranslate): string {
  return t("files.chatCount", { count });
}

/** A share from `sharePercent`, such as "12%" or "0.1%". */
export function sharePercentLabel(percent: number, format: AppFormat): string {
  return format.percent(percent / 100, { maximumFractionDigits: 1 });
}
