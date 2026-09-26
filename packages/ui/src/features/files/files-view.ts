/*
 * Display helpers for the Files and storage views (issue #496). The row and usage shapes are the IPC
 * contract in `@openbot/contracts/ipc`; labels, grouping and filters stay here, beside the views.
 */

import type { AttachmentSummary, StorageBreakdown, StorageCategory, StoredFileRow } from "@openbot/contracts/ipc";
import type { AppFormat, AppTextKey, AppTranslate } from "@openbot/i18n";

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
 * The bar shows five groups, not eight categories: past four hues a stacked bar stops being
 * readable, so the app's own data folds into one neutral "App data" segment.
 */
export type StorageGroup = "workspaces" | "files" | "chats" | "downloads" | "app";

export const STORAGE_GROUPS: readonly StorageGroup[] = ["workspaces", "files", "chats", "downloads", "app"];

export const STORAGE_GROUP_LABELS = {
  workspaces: "files.group.workspaces",
  files: "files.group.files",
  chats: "files.group.chats",
  downloads: "files.group.downloads",
  app: "files.group.app",
} as const satisfies Record<StorageGroup, AppTextKey>;

const STORAGE_GROUP_OF: Record<StorageCategory, StorageGroup> = {
  workspaces: "workspaces",
  attachments: "files",
  generated: "files",
  chats: "chats",
  downloads: "downloads",
  caches: "app",
  runtimes: "app",
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

export type FileType = "images" | "documents" | "code" | "spreadsheets" | "media" | "other";
export type FileTypeFilter = "all" | FileType;

export const FILE_TYPE_FILTERS: ReadonlyArray<{ value: FileTypeFilter; label: AppTextKey }> = [
  { value: "all", label: "files.type.all" },
  { value: "images", label: "files.type.images" },
  { value: "documents", label: "files.type.documents" },
  { value: "code", label: "files.type.code" },
  { value: "spreadsheets", label: "files.type.spreadsheets" },
  { value: "media", label: "files.type.media" },
  { value: "other", label: "files.type.other" },
];

const DOCUMENT_EXTENSIONS = new Set(["doc", "docx", "md", "odt", "pdf", "ppt", "pptx", "rtf", "txt"]);
const CODE_EXTENSIONS = new Set([
  "c",
  "cc",
  "cpp",
  "cs",
  "css",
  "go",
  "html",
  "java",
  "js",
  "json",
  "jsx",
  "php",
  "py",
  "rb",
  "rs",
  "sh",
  "sql",
  "swift",
  "ts",
  "tsx",
  "vue",
  "yaml",
  "yml",
]);
const SPREADSHEET_EXTENSIONS = new Set(["csv", "numbers", "ods", "tsv", "xls", "xlsx"]);

const MEDIA_EXTENSIONS = new Set(["aac", "flac", "m4a", "mov", "mp3", "mp4", "ogg", "wav", "webm"]);

export function fileTypeOf(file: Pick<AttachmentSummary, "name" | "kind" | "mimeType" | "previewKind">): FileType {
  if (file.kind === "image" || file.previewKind === "image" || file.mimeType.startsWith("image/")) return "images";
  const extension = file.name.split(".").at(-1)?.toLocaleLowerCase() ?? "";
  if (file.mimeType.startsWith("audio/") || file.mimeType.startsWith("video/") || MEDIA_EXTENSIONS.has(extension))
    return "media";
  if (SPREADSHEET_EXTENSIONS.has(extension)) return "spreadsheets";
  if (CODE_EXTENSIONS.has(extension)) return "code";
  if (DOCUMENT_EXTENSIONS.has(extension) || file.previewKind === "pdf") return "documents";
  return "other";
}

export type FileSort = "newest" | "largest" | "name";

export const FILE_SORTS: ReadonlyArray<{ value: FileSort; label: AppTextKey }> = [
  { value: "newest", label: "files.sort.newest" },
  { value: "largest", label: "files.sort.largest" },
  { value: "name", label: "files.sort.name" },
];

export interface FileQuery {
  search: string;
  type: FileTypeFilter;
  sort: FileSort;
}

export function queryFiles(files: readonly StoredFileRow[], query: FileQuery): StoredFileRow[] {
  const search = query.search.trim().toLocaleLowerCase();
  const matches = files.filter(
    (file) =>
      (query.type === "all" || fileTypeOf(file) === query.type) &&
      (!search ||
        file.name.toLocaleLowerCase().includes(search) ||
        Boolean(file.conversation?.title.toLocaleLowerCase().includes(search))),
  );
  return matches.sort((left, right) => {
    if (query.sort === "largest") return right.size - left.size;
    if (query.sort === "name") return left.name.localeCompare(right.name);
    return Date.parse(right.createdAt) - Date.parse(left.createdAt);
  });
}

/** Counts per type for the filter chips. Counts ignore the current type filter but follow the search. */
export function fileTypeCounts(files: readonly StoredFileRow[]): Record<FileTypeFilter, number> {
  const counts: Record<FileTypeFilter, number> = {
    all: files.length,
    images: 0,
    documents: 0,
    code: 0,
    spreadsheets: 0,
    media: 0,
    other: 0,
  };
  for (const file of files) counts[fileTypeOf(file)] += 1;
  return counts;
}

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
