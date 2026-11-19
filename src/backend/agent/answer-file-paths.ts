import {
  ARCHIVE_ATTACHMENT_EXTENSIONS,
  attachmentFileExtension,
  IMAGE_ATTACHMENT_EXTENSIONS,
  MEDIA_ATTACHMENT_EXTENSIONS,
  MP4_ATTACHMENT_EXTENSIONS,
} from "@openbot/contracts/attachment-files";

const ABSOLUTE_PATH = /(?<=^|[\s"'`(<[*])(?:~\/|\/|[A-Za-z]:[\\/])[^\s"'`<>()[\]]+/gu;
const PATH_CODE_SPAN = /`((?:~\/|\/|[A-Za-z]:[\\/])[^`\n]+)`/gu;
const FILE_URL = /file:\/\/(\/[^\s"'`<>()[\]]+)/gu;
const TRAILING_PUNCTUATION = /[.,;:!?*]+$/u;

const ANSWER_FILE_EXTENSIONS: ReadonlySet<string> = new Set([
  ...IMAGE_ATTACHMENT_EXTENSIONS,
  ...MEDIA_ATTACHMENT_EXTENSIONS,
  ...MP4_ATTACHMENT_EXTENSIONS,
  ...ARCHIVE_ATTACHMENT_EXTENSIONS,
  "pdf",
  "doc",
  "docx",
  "odt",
  "rtf",
  "xls",
  "xlsx",
  "ods",
  "ppt",
  "pptx",
  "odp",
  "csv",
  "txt",
  "md",
]);

export function answerFilePaths(text: string): string[] {
  const paths = new Set<string>();
  const add = (value: string) => {
    const path = value.trim().replace(TRAILING_PUNCTUATION, "");
    if (ANSWER_FILE_EXTENSIONS.has(attachmentFileExtension(path) ?? "")) paths.add(path);
  };
  for (const match of text.matchAll(FILE_URL)) {
    const path = match[1] ?? "";
    try {
      add(decodeURIComponent(path));
    } catch {
      add(path);
    }
  }
  for (const match of text.matchAll(PATH_CODE_SPAN)) add(match[1] ?? "");
  for (const match of text.matchAll(ABSOLUTE_PATH)) add(match[0]);
  return [...paths];
}
