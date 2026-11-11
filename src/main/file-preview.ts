import { readFile, realpath, stat } from "node:fs/promises";
import { dirname, extname, isAbsolute, relative, resolve, sep } from "node:path";
import { attachmentFileExtension, attachmentMimeTypeForName } from "@openbot/contracts/attachment-files";
import { CHAT_VISUAL_PAGE_LIMIT, isChatVisualMimeType } from "@openbot/contracts/chat-visual";
import { ATTACHMENT_LIMITS } from "@openbot/contracts/input-limits";
import { type FilePreview, filePreviewKindForFile } from "@openbot/contracts/ipc";
import { sourceText } from "@openbot/i18n/source";
import { Effect } from "effect";
import { attachmentCall } from "../backend/attachment-effects";
import { filePreviewPages } from "./file-preview-pages";

export function mimeTypeForName(name: string) {
  return attachmentMimeTypeForName(name);
}

export function filePreviewFromBytes(name: string, bytes: Uint8Array): FilePreview {
  if (bytes.byteLength > ATTACHMENT_LIMITS.fileBytes) throw new Error(sourceText("error.attachment.previewTooLarge"));
  const mimeType = mimeTypeForName(name);
  const kind = filePreviewKindForFile(name, mimeType);
  return { name, size: bytes.byteLength, mimeType, previewKind: kind, bytes: kind === "none" ? null : bytes };
}

const IMAGE_MIME_TYPES: Readonly<Record<string, string>> = {
  ".apng": "image/apng",
  ".avif": "image/avif",
  ".bmp": "image/bmp",
  ".gif": "image/gif",
  ".ico": "image/x-icon",
  ".jpeg": "image/jpeg",
  ".jpg": "image/jpeg",
  ".png": "image/png",
  ".svg": "image/svg+xml",
  ".webp": "image/webp",
};

/** A quoted `src` attribute or a CSS `url()`. Group 3 or 6 is its address. */
const IMAGE_REFERENCE = /(\bsrc\s*=\s*)(["'])([^"'<>]*)\2|(\burl\(\s*)(["']?)([^"'()<>]*?)\5(\s*\))/giu;

function insideFolder(folder: string, path: string): boolean {
  const rest = relative(folder, path);
  return rest !== "" && rest !== ".." && !rest.startsWith(`..${sep}`) && !isAbsolute(rest);
}

/** The image file that a relative address names in the page's folder or below it. */
function folderImagePath(folder: string, address: string): string | undefined {
  // An address with a scheme, a root or a network path, or a place in the page, is not a file here.
  if (/^(?:[a-z][a-z\d+.-]*:|[\\/]|#)/iu.test(address)) return undefined;
  let name: string;
  try {
    name = decodeURIComponent(address.split(/[?#]/u, 1)[0] ?? "");
  } catch {
    return undefined;
  }
  if (!IMAGE_MIME_TYPES[extname(name).toLowerCase()]) return undefined;
  const path = resolve(folder, name);
  return insideFolder(folder, path) ? path : undefined;
}

/**
 * The page of a local HTML file, with the images that it names by a relative address in its own
 * folder put in as `data:` addresses. The page has an opaque address, so it cannot load them itself,
 * and it never names a path to main. An image outside the folder, through a link too, or one that
 * does not fit in the page limit stays as it is.
 */
const inlineFolderImages = Effect.fn("FilePreview.inlineFolderImages")(function* (path: string, bytes: Uint8Array) {
  const html = new TextDecoder().decode(bytes);
  const uses = new Map<string, number>();
  for (const match of html.matchAll(IMAGE_REFERENCE)) {
    const address = match[3] ?? match[6];
    if (address) uses.set(address, (uses.get(address) ?? 0) + 1);
  }
  const folder = dirname(path);
  const images = new Map<string, string>();
  let size = bytes.byteLength;
  for (const [address, count] of uses) {
    const image = folderImagePath(folder, address);
    if (!image) continue;
    const prefix = `data:${IMAGE_MIME_TYPES[extname(image).toLowerCase()]};base64,`;
    const growth = (length: number) => (prefix.length + Math.ceil(length / 3) * 4 - Buffer.byteLength(address)) * count;
    const content = yield* attachmentCall(async () => {
      const [realFolder, realImage] = await Promise.all([realpath(folder), realpath(image)]);
      const file = await stat(realImage);
      if (!insideFolder(realFolder, realImage) || !file.isFile() || size + growth(file.size) > CHAT_VISUAL_PAGE_LIMIT)
        return undefined;
      return readFile(realImage);
    }).pipe(Effect.orElseSucceed(() => undefined));
    if (!content || size + growth(content.byteLength) > CHAT_VISUAL_PAGE_LIMIT) continue;
    size += growth(content.byteLength);
    images.set(address, prefix + content.toString("base64"));
  }
  if (images.size === 0) return bytes;
  const page = html.replace(IMAGE_REFERENCE, (match, src, quote, srcAddress, url, urlQuote, urlAddress, end) => {
    const address = srcAddress ?? urlAddress;
    const image = address === undefined ? undefined : images.get(address);
    if (!image) return match;
    return srcAddress === undefined ? `${url}${urlQuote}${image}${urlQuote}${end}` : `${src}${quote}${image}${quote}`;
  });
  return new TextEncoder().encode(page);
});

export const localFilePreview = Effect.fn("FilePreview.local")(function* (
  path: string,
  name: string,
  size: number,
  generation: number,
  maxBytes: number = ATTACHMENT_LIMITS.fileBytes,
) {
  const extension = attachmentFileExtension(name);
  const mimeType = extension === "html" || extension === "htm" ? "text/html" : mimeTypeForName(name);
  // A file over the limit is not read. The panel still opens, reveals and saves it by its path.
  const kind = size > Math.min(maxBytes, ATTACHMENT_LIMITS.fileBytes) ? "none" : filePreviewKindForFile(name, mimeType);
  const bytes = kind === "none" ? null : new Uint8Array(yield* attachmentCall(() => readFile(path)));
  const page =
    bytes && isChatVisualMimeType(mimeType) && bytes.byteLength <= CHAT_VISUAL_PAGE_LIMIT
      ? yield* inlineFolderImages(path, bytes)
      : bytes;
  const pageUrl = page ? filePreviewPages.add(mimeType, page, generation) : undefined;
  return {
    name,
    size,
    mimeType,
    previewKind: kind,
    bytes,
    ...(pageUrl ? { pageUrl } : {}),
  };
});
