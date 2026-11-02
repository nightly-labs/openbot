import {
  ARCHIVE_ATTACHMENT_EXTENSIONS,
  attachmentFileExtension,
  IMAGE_ATTACHMENT_EXTENSIONS,
  MEDIA_ATTACHMENT_EXTENSIONS,
  MP4_ATTACHMENT_EXTENSIONS,
} from "@openbot/contracts/attachment-files";

/**
 * A path starts at the start of a line, after a space, or after an opening quote, bracket or bold mark,
 * so the path part of a web address does not match. `file://` links and code spans that hold only a
 * path, which can contain spaces, are read separately.
 */
const ABSOLUTE_PATH = /(?<=^|[\s"'`(<[*])(?:~\/|\/|[A-Za-z]:[\\/])[^\s"'`<>()[\]]+/gu;
const PATH_CODE_SPAN = /`((?:~\/|\/|[A-Za-z]:[\\/])[^`\n]+)`/gu;
const FILE_URL = /file:\/\/(\/[^\s"'`<>()[\]]+)/gu;
const TRAILING_PUNCTUATION = /[.,;:!?*]+$/u;

/**
 * Only the outputs that a person opens: an answer names configuration, logs and source files too, and
 * these can hold secrets. The agent can still attach any supported file with the attach tool.
 */
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

/**
 * The absolute paths of output files that an agent answer names, in order and without repeats. The
 * answer text does not change; the turn end attaches the files that resolve inside the agent's
 * permitted folders.
 */
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
