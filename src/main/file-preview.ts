import { readFile, realpath, stat } from "node:fs/promises";
import { dirname, isAbsolute, relative, resolve, sep } from "node:path";
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

/** At most this many different image addresses of one page are looked up. */
const IMAGE_ADDRESS_LIMIT = 256;

/**
 * A `src` attribute, in double quotes, single quotes or none, or a CSS `url()`. Group 1, 2, 3 or 5
 * is its address.
 */
const IMAGE_REFERENCE =
  /\bsrc\s*=\s*(?:"([^"<>]*)"|'([^'<>]*)'|([^\s"'<>`=]+))|\burl\(\s*(["']?)([^"'()<>]*?)\4\s*\)/dgiu;

interface FolderImage {
  path: string;
  mimeType: string;
  /** The place in the image, such as `#icon` of an SVG sprite, which its new address keeps. */
  fragment: string;
}

function insideFolder(folder: string, path: string): boolean {
  const rest = relative(folder, path);
  return rest !== "" && rest !== ".." && !rest.startsWith(`..${sep}`) && !isAbsolute(rest);
}

/** The image file that a relative address names in the page's folder or below it. */
function folderImage(folder: string, address: string): FolderImage | undefined {
  // An address with a scheme, a root or a network path, or a place in the page, is not a file here.
  if (/^(?:[a-z][a-z\d+.-]*:|[\\/]|#)/iu.test(address)) return undefined;
  const hash = address.indexOf("#");
  let name: string;
  try {
    name = decodeURIComponent((address.replaceAll("&amp;", "&").split(/[?#]/u, 1)[0] ?? "").trim());
  } catch {
    return undefined;
  }
  const mimeType = attachmentMimeTypeForName(name);
  if (!mimeType.startsWith("image/")) return undefined;
  const path = resolve(folder, name);
  return insideFolder(folder, path) ? { path, mimeType, fragment: hash < 0 ? "" : address.slice(hash) } : undefined;
}

/** The real path of the image, when it is a file and no link leads it out of the folder. */
const realFolderImage = (realFolder: string, image: FolderImage) =>
  attachmentCall(async () => {
    const path = await realpath(image.path);
    return insideFolder(realFolder, path) && (await stat(path)).isFile() ? { ...image, path } : undefined;
  }).pipe(Effect.orElseSucceed(() => undefined));

/**
 * The page of a local HTML file, with each image that it names by a relative address in its own
 * folder at an address that main gives it. The page has an opaque address, so it cannot load them
 * itself, and it never names a path to main. An image outside the folder, through a link too,
 * stays as it is. The addresses go with the page, so `add` or `release` drops them.
 */
const linkFolderImages = Effect.fn("FilePreview.linkFolderImages")(function* (
  path: string,
  bytes: Uint8Array,
  generation: number,
) {
  const html = new TextDecoder().decode(bytes);
  const spans: { start: number; end: number; address: string }[] = [];
  for (const match of html.matchAll(IMAGE_REFERENCE)) {
    const group = [1, 2, 3, 5].find((index) => match[index]);
    const span = group === undefined ? undefined : match.indices?.[group];
    const address = group === undefined ? undefined : match[group];
    if (!span || !address) continue;
    // A `src` in the text of the page, such as in a code sample, is not an attribute.
    if (group !== 5 && html.lastIndexOf("<", match.index) <= html.lastIndexOf(">", match.index)) continue;
    spans.push({ start: span[0], end: span[1], address });
  }
  const folder = dirname(path);
  const candidates = [...new Set(spans.map((span) => span.address))]
    .slice(0, IMAGE_ADDRESS_LIMIT)
    .flatMap((address) => {
      const image = folderImage(folder, address);
      return image ? [{ address, image }] : [];
    });
  if (candidates.length === 0) return { bytes, images: [] };
  const realFolder = yield* attachmentCall(() => realpath(folder));
  const found = yield* Effect.forEach(candidates, ({ image }) => realFolderImage(realFolder, image), {
    concurrency: 8,
  });
  const links = new Map<string, string>();
  for (const [index, image] of found.entries()) {
    const candidate = candidates[index];
    const link = image && candidate ? filePreviewPages.addImage(image.path, image.mimeType, generation) : undefined;
    if (link && candidate && image) links.set(candidate.address, `${link}${image.fragment}`);
  }
  const images = [...new Set([...links.values()].map((link) => link.split("#", 1)[0] ?? link))];
  let page = "";
  let last = 0;
  for (const span of spans) {
    const link = links.get(span.address);
    if (!link) continue;
    page += html.slice(last, span.start) + link;
    last = span.end;
  }
  const linked = new TextEncoder().encode(page + html.slice(last));
  if (images.length === 0 || linked.byteLength > CHAT_VISUAL_PAGE_LIMIT) {
    for (const image of images) filePreviewPages.release(image);
    return { bytes, images: [] };
  }
  return { bytes: linked, images };
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
      ? yield* linkFolderImages(path, bytes, generation).pipe(Effect.orElseSucceed(() => ({ bytes, images: [] })))
      : { bytes, images: [] };
  const pageUrl = page.bytes ? filePreviewPages.add(mimeType, page.bytes, generation, page.images) : undefined;
  return {
    name,
    size,
    mimeType,
    previewKind: kind,
    bytes,
    ...(pageUrl ? { pageUrl } : {}),
  };
});
