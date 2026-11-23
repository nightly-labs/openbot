export const IMAGE_ATTACHMENT_EXTENSIONS = ["png", "jpg", "jpeg", "gif", "webp", "avif"] as const;

export const MEDIA_ATTACHMENT_EXTENSIONS = ["mp3", "mov"] as const;

const NAMED_AUDIO_EXTENSIONS = ["m4a", "wav", "aac", "ogg", "oga", "opus", "flac"] as const;

export const ARCHIVE_ATTACHMENT_EXTENSIONS = ["zip"] as const;

export const MP4_ATTACHMENT_EXTENSIONS = ["mp4"] as const;

export const SVG_ATTACHMENT_EXTENSIONS = ["svg"] as const;

export const CONTEXT_ATTACHMENT_EXTENSIONS = [
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
  "txt",
  "md",
  "markdown",
  "csv",
  "json",
  "jsonl",
  "log",
  "xml",
  "yaml",
  "yml",
  "bash",
  "c",
  "cc",
  "conf",
  "cpp",
  "cs",
  "css",
  "cts",
  "env",
  "eml",
  "fish",
  "go",
  "gradle",
  "h",
  "hpp",
  "htm",
  "html",
  "ini",
  "ipynb",
  "java",
  "js",
  "jsx",
  "kt",
  "kts",
  "lock",
  "mjs",
  "mts",
  "php",
  "properties",
  "ps1",
  "py",
  "rb",
  "rs",
  "scala",
  "sh",
  "sql",
  "svelte",
  "swift",
  "toml",
  "ts",
  "tsx",
  "tex",
  "vue",
  "zsh",
] as const;

export const ATTACHMENT_FILE_EXTENSIONS = [
  ...IMAGE_ATTACHMENT_EXTENSIONS,
  ...MEDIA_ATTACHMENT_EXTENSIONS,
  ...ARCHIVE_ATTACHMENT_EXTENSIONS,
  ...MP4_ATTACHMENT_EXTENSIONS,
  ...SVG_ATTACHMENT_EXTENSIONS,
  ...CONTEXT_ATTACHMENT_EXTENSIONS,
] as const;

export const OPENABLE_ATTACHMENT_EXTENSIONS = [
  ...IMAGE_ATTACHMENT_EXTENSIONS,
  ...MEDIA_ATTACHMENT_EXTENSIONS,
  ...NAMED_AUDIO_EXTENSIONS,
  ...MP4_ATTACHMENT_EXTENSIONS,
  "pdf",
  "docx",
  "odt",
  "rtf",
  "xlsx",
  "ods",
  "pptx",
  "odp",
  "eml",
  "txt",
  "md",
  "markdown",
  "csv",
  "log",
] as const;

export interface AttachmentSupport {
  eml: boolean;
  media: boolean;
  zip: boolean;
  mp4: boolean;
  svg: boolean;
  anyFile: boolean;
}

export function supportedAttachmentExtensions(support: Omit<AttachmentSupport, "anyFile">): string[] {
  return ATTACHMENT_FILE_EXTENSIONS.filter(
    (extension) =>
      (support.eml || extension !== "eml") &&
      (support.media || !MEDIA_ATTACHMENT_EXTENSIONS.some((media) => media === extension)) &&
      (support.zip || !ARCHIVE_ATTACHMENT_EXTENSIONS.some((archive) => archive === extension)) &&
      (support.mp4 || !MP4_ATTACHMENT_EXTENSIONS.some((mp4) => mp4 === extension)) &&
      (support.svg || !SVG_ATTACHMENT_EXTENSIONS.some((svg) => svg === extension)),
  );
}

export const ATTACHMENT_FILE_ACCEPT = ATTACHMENT_FILE_EXTENSIONS.map((extension) => `.${extension}`).join(",");
export const SUPPORTED_ATTACHMENT_DESCRIPTION =
  "images, MP3 audio, MOV or MP4 video, ZIP archives, PDF, Office documents, EML, text, Markdown, data, or source files";

export const XLSX_MIME_TYPE = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
export const DOCX_MIME_TYPE = "application/vnd.openxmlformats-officedocument.wordprocessingml.document";

const SUPPORTED_EXTENSIONS = new Set<string>(ATTACHMENT_FILE_EXTENSIONS);
const EXTENSIONLESS_TEXT_FILES = new Set(["dockerfile", "makefile", "procfile"]);

export function attachmentFileExtension(name: string): string | null {
  const basename = name.split(/[\\/]/u).at(-1)?.trim().toLowerCase() ?? "";
  const dot = basename.lastIndexOf(".");
  return dot >= 0 && dot < basename.length - 1 ? basename.slice(dot + 1) : null;
}

export function isSupportedAttachmentName(name: string): boolean {
  const basename = name.split(/[\\/]/u).at(-1)?.trim().toLowerCase() ?? "";
  const extension = attachmentFileExtension(basename);
  return EXTENSIONLESS_TEXT_FILES.has(basename) || (extension !== null && SUPPORTED_EXTENSIONS.has(extension));
}

const OPENABLE_EXTENSIONS = new Set<string>(OPENABLE_ATTACHMENT_EXTENSIONS);

export function isOpenableAttachmentName(name: string): boolean {
  const extension = attachmentFileExtension(name);
  return extension !== null && OPENABLE_EXTENSIONS.has(extension);
}

export function rasterImageMimeType(name: string): string | null {
  const extension = attachmentFileExtension(name);
  return IMAGE_ATTACHMENT_EXTENSIONS.some((image) => image === extension) ? attachmentMimeTypeForName(name) : null;
}

export function isSupportedAttachmentNameFor(name: string, support: AttachmentSupport): boolean {
  if (!isSupportedAttachmentName(name)) return support.anyFile;
  const extension = attachmentFileExtension(name);
  if (extension === "eml") return support.eml;
  if (MEDIA_ATTACHMENT_EXTENSIONS.some((media) => media === extension)) return support.media;
  if (ARCHIVE_ATTACHMENT_EXTENSIONS.some((archive) => archive === extension)) return support.zip;
  if (MP4_ATTACHMENT_EXTENSIONS.some((mp4) => mp4 === extension)) return support.mp4;
  if (SVG_ATTACHMENT_EXTENSIONS.some((svg) => svg === extension)) return support.svg;
  return true;
}

export function assertSupportedAttachmentName(name: string): void {
  if (isSupportedAttachmentName(name)) return;
  throw new Error(
    `${name} is not supported. Attach ${SUPPORTED_ATTACHMENT_DESCRIPTION}. For other audio or video formats, export as MP3, MOV, or MP4, or attach a text transcript.`,
  );
}

export function attachmentMimeTypeForName(name: string) {
  switch (attachmentFileExtension(name)) {
    case "png":
      return "image/png";
    case "jpg":
    case "jpeg":
      return "image/jpeg";
    case "gif":
      return "image/gif";
    case "webp":
      return "image/webp";
    case "avif":
      return "image/avif";
    case "mp3":
      return "audio/mpeg";
    case "m4a":
      return "audio/mp4";
    case "wav":
      return "audio/wav";
    case "aac":
      return "audio/aac";
    case "ogg":
    case "oga":
    case "opus":
      return "audio/ogg";
    case "flac":
      return "audio/flac";
    case "mov":
      return "video/quicktime";
    case "mp4":
      return "video/mp4";
    case "zip":
      return "application/zip";
    case "pdf":
      return "application/pdf";
    case "svg":
      return "image/svg+xml";
    case "eml":
      return "message/rfc822";
    case "doc":
      return "application/msword";
    case "docx":
      return DOCX_MIME_TYPE;
    case "odt":
      return "application/vnd.oasis.opendocument.text";
    case "rtf":
      return "application/rtf";
    case "xls":
      return "application/vnd.ms-excel";
    case "xlsx":
      return XLSX_MIME_TYPE;
    case "ods":
      return "application/vnd.oasis.opendocument.spreadsheet";
    case "ppt":
      return "application/vnd.ms-powerpoint";
    case "pptx":
      return "application/vnd.openxmlformats-officedocument.presentationml.presentation";
    case "odp":
      return "application/vnd.oasis.opendocument.presentation";
    case "md":
    case "markdown":
      return "text/markdown";
    case "html":
    case "htm":
      return "text/html";
    case "json":
    case "jsonl":
    case "ipynb":
      return "application/json";
    default:
      return isSupportedAttachmentName(name) ? "text/plain" : "application/octet-stream";
  }
}

export function playableMediaKind(mimeType: string): "audio" | "video" | null {
  if (mimeType.startsWith("audio/")) return "audio";
  if (mimeType.startsWith("video/")) return "video";
  return null;
}

export function isXlsxMimeType(mimeType: string): boolean {
  return mimeType === XLSX_MIME_TYPE;
}

export function isDocxMimeType(mimeType: string): boolean {
  return mimeType === DOCX_MIME_TYPE;
}
