/**
 * The type mark of a file that a message names: a short badge such as "JSON", and the colour
 * family (`--openbot-file-*`) of its name. Desktop and mobile draw file references with it, so a
 * file reads the same on both.
 */
const CODE_BADGES = new Set([
  "c",
  "cc",
  "cpp",
  "cs",
  "css",
  "go",
  "html",
  "java",
  "js",
  "jsx",
  "json",
  "md",
  "php",
  "py",
  "rb",
  "rs",
  "sql",
  "swift",
  "ts",
  "tsx",
  "vue",
]);

const DOCUMENT_BADGES = new Set(["doc", "docx", "odt", "pdf", "rtf"]);
const IMAGE_BADGES = new Set(["avif", "gif", "heic", "jpeg", "jpg", "png", "svg", "webp"]);
const ARCHIVE_BADGES = new Set(["7z", "gz", "rar", "tar", "zip"]);
const DATA_BADGES = new Set(["csv", "ods", "xls", "xlsx"]);
const PRESENTATION_BADGES = new Set(["odp", "ppt", "pptx"]);
const MEDIA_BADGES = new Set(["avi", "flac", "m4a", "mkv", "mov", "mp3", "mp4", "ogg", "wav", "webm"]);
const BADGED_EXTENSIONS = new Set([
  ...CODE_BADGES,
  ...DOCUMENT_BADGES,
  ...IMAGE_BADGES,
  ...ARCHIVE_BADGES,
  ...DATA_BADGES,
  ...PRESENTATION_BADGES,
  ...MEDIA_BADGES,
]);

export type FileReferenceTone = "source" | "script" | "markup" | "style" | "data" | "document" | "media" | "default";

const BLUE_EXTENSIONS = new Set(["c", "cc", "cpp", "md", "py", "ts", "tsx", "doc", "docx", "odt", "rtf"]);
const YELLOW_EXTENSIONS = new Set(["js", "jsx", "json", ...ARCHIVE_BADGES]);
const ORANGE_EXTENSIONS = new Set(["html", "java", "rs", "swift", ...PRESENTATION_BADGES]);
const TEAL_EXTENSIONS = new Set(["css", "go", "sql"]);
const GREEN_EXTENSIONS = new Set(["vue", ...DATA_BADGES]);
const RED_EXTENSIONS = new Set(["rb", "pdf"]);
const PINK_EXTENSIONS = new Set([...IMAGE_BADGES, ...MEDIA_BADGES]);

function fileReferenceExtension(name: string): string {
  return name.split(".").at(-1)?.toLocaleLowerCase() ?? "";
}

export function fileReferenceBadge(name: string): string | null {
  const extension = fileReferenceExtension(name);
  return BADGED_EXTENSIONS.has(extension) ? extension.slice(0, 4).toLocaleUpperCase() : null;
}

export function fileReferenceTone(name: string): FileReferenceTone {
  const extension = fileReferenceExtension(name);
  if (BLUE_EXTENSIONS.has(extension)) return "source";
  if (YELLOW_EXTENSIONS.has(extension)) return "script";
  if (ORANGE_EXTENSIONS.has(extension)) return "markup";
  if (TEAL_EXTENSIONS.has(extension)) return "style";
  if (GREEN_EXTENSIONS.has(extension)) return "data";
  if (RED_EXTENSIONS.has(extension)) return "document";
  if (PINK_EXTENSIONS.has(extension)) return "media";
  return "default";
}

/** The last part of a path, decoded when it is URL-encoded. */
export function fileReferenceName(path: string): string {
  const name = path.replaceAll("\\", "/").split("/").at(-1) || "file";
  try {
    return decodeURIComponent(name);
  } catch {
    return name;
  }
}

/** Whether inline code names a file, by its extension or a known file name, not by a lookup. */
export function isFileReference(value: string): boolean {
  if (!value || /[\0\r\n]/u.test(value) || /[/\\]$/u.test(value)) return false;
  const name = fileReferenceName(value);
  if (/^(Dockerfile|Makefile|\.gitignore)$/iu.test(name)) return true;
  return /\.(?:avif|bash|c|conf|cpp|cs|css|csv|env|fish|gif|go|h|hpp|html?|ini|java|jpe?g|jsx?|json|kt|kts|log|markdown|md|pdf|php|png|ps1|py|rb|rs|scala|sh|sql|swift|toml|tsx?|txt|webp|xml|ya?ml|zsh)$/iu.test(
    name,
  );
}
