import type { AttachmentSummary, StoredFileRow } from "@openbot/contracts/ipc";

export type FileType = "images" | "documents" | "code" | "spreadsheets" | "media" | "other";
export type FileTypeFilter = "all" | FileType;

export const FILE_TYPE_FILTER_VALUES: readonly FileTypeFilter[] = [
  "all",
  "images",
  "documents",
  "code",
  "spreadsheets",
  "media",
  "other",
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
