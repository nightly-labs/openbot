import { attachmentFileExtension } from "@openbot/contracts/attachment-files";
import { MOBILE_ATTACHMENT_BYTES } from "@openbot/team-client/remote-peer";
import * as Crypto from "expo-crypto";
import { Directory, File, Paths } from "expo-file-system";
import { ImageManipulator, SaveFormat } from "expo-image-manipulator";
import {
  clearSharedPayloads,
  getResolvedSharedPayloadsAsync,
  getSharedPayloads,
  type ResolvedSharePayload,
  type SharePayload,
} from "expo-sharing";
import { smallerPhoto } from "@/features/chat/model/smaller-photo";
import { isAndroid } from "@/shared/lib/platform";

/** A file that another app shared. It is a copy in this app's cache, which the receiver deletes. */
interface SharedFile {
  uri: string;
  name: string;
  /** Null when the system does not tell the size. */
  size: number | null;
}

export interface IncomingShare {
  /** Shared text and links, one per line. */
  text: string;
  files: SharedFile[];
  /** The folder that holds the copies of this share's files. */
  folder: string;
}

const SHARE_FOLDER = "incoming-share";

/** The image types that a shared link can bring as a file. HEIC becomes JPEG, as below. */
const LINKED_IMAGE_EXTENSIONS: Readonly<Record<string, string>> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/gif": "gif",
  "image/webp": "webp",
  "image/avif": "avif",
  "image/heic": "heic",
  "image/heif": "heif",
};

/** A shared link whose address answers with an image. */
interface LinkedImage {
  link: string;
  uri: string;
  name: string;
}

function sharedPayloads(): SharePayload[] {
  try {
    return getSharedPayloads();
  } catch {
    // A build without the share extension has no App Group setting for it, and Expo Go has no module.
    return [];
  }
}

function clearShare(): void {
  try {
    clearSharedPayloads();
  } catch {
    // Nothing waits where the module is missing.
  }
}

/** True while a share waits. It reads no file. */
export function hasIncomingShare(): boolean {
  return sharedPayloads().length > 0;
}

function isTextPayload(payload: SharePayload): boolean {
  return payload.shareType === "text" || payload.shareType === "url";
}

function fileName(uri: string): string {
  const last = uri.split("/").at(-1) ?? "";
  try {
    return decodeURIComponent(last);
  } catch {
    return last;
  }
}

/** The share's files, before they move. iOS copies them into the App Group; Android names a content URI. */
async function sourceFiles(payloads: SharePayload[]): Promise<{ uri: string; name: string }[]> {
  const files = payloads.filter((payload) => !isTextPayload(payload));
  if (files.length === 0) return [];
  if (!isAndroid) return files.map((payload) => ({ uri: payload.value, name: fileName(payload.value) }));
  // A content URI has no file name. Resolving gives the name and a copy in the cache. Android sends
  // files or text in one share, never both, so this resolves no link.
  const resolved = await getResolvedSharedPayloadsAsync();
  return resolved.flatMap((payload) =>
    payload.contentUri ? [{ uri: payload.contentUri, name: payload.originalName ?? fileName(payload.contentUri) }] : [],
  );
}

/** HEIC is not an attachment type. As the photo picker does, the share sends a JPEG copy. */
async function compatibleImage(file: File, name: string, folder: Directory): Promise<SharedFile> {
  const image = await ImageManipulator.manipulate(file.uri).renderAsync();
  const saved = await image.saveAsync({ format: SaveFormat.JPEG, compress: 0.9 });
  const jpeg = new File(saved.uri);
  const jpegName = `${name.replace(/\.(heic|heif)$/iu, "")}.jpg`;
  await jpeg.move(new File(folder, jpegName));
  file.delete();
  return { uri: jpeg.uri, name: jpegName, size: jpeg.size };
}

/** The file as the receiver gets it: a HEIC image as JPEG. */
async function sharedFile(file: File, name: string, folder: Directory): Promise<SharedFile> {
  const kept = { uri: file.uri, name, size: file.exists ? file.size : null };
  if (!/\.(heic|heif)$/iu.test(name)) return kept;
  try {
    // The smaller copy is already a JPEG, so the photo is decoded one time only.
    const smaller = await smallerPhoto(file.uri, name);
    if (smaller.uri !== file.uri) {
      const jpeg = new File(smaller.uri);
      await jpeg.move(new File(folder, smaller.name));
      file.delete();
      return { uri: jpeg.uri, name: smaller.name, size: jpeg.size };
    }
    return await compatibleImage(file, name, folder);
  } catch {
    // The receiver refuses the HEIC file by name, as it does in the picker.
    return kept;
  }
}

async function moveInto(folder: Directory, source: { uri: string; name: string }): Promise<SharedFile> {
  // The receiver refuses a name without a known extension and names the file in its error.
  const name = source.name.replace(/[/\\]/gu, "_") || "shared-file";
  const file = new File(source.uri);
  // Another share can use the same name in the App Group, so each share keeps its files apart.
  await file.move(new File(folder, name), { overwrite: true });
  return sharedFile(file, name, folder);
}

/** A name with the extension of the image type, which decides how the host reads the file. */
function linkedImageName(originalName: string | null, extension: string): string {
  const name = (originalName ?? "").replace(/[/\\]/gu, "_");
  const current = attachmentFileExtension(name);
  if (current === extension || (current === "jpeg" && extension === "jpg")) return name;
  return `${name.replace(/\.[^.]*$/u, "") || "image"}.${extension}`;
}

/**
 * An image from a web page can come only as its address, as from Safari. Messages sends the image, so
 * the share does too: the system reads the headers of each shared link, and a link to an image of at
 * most 10 MB comes as a file. A page, or a link that does not answer, stays a link.
 */
async function linkedImages(payloads: SharePayload[]): Promise<LinkedImage[]> {
  if (!payloads.some((payload) => payload.shareType === "url")) return [];
  let resolved: ResolvedSharePayload[];
  try {
    resolved = await getResolvedSharedPayloadsAsync();
  } catch {
    return [];
  }
  return resolved.flatMap((payload) => {
    const mimeType = payload.contentMimeType?.split(";")[0]?.trim().toLowerCase() ?? "";
    const extension = LINKED_IMAGE_EXTENSIONS[mimeType];
    const size = payload.contentSize ?? -1;
    if (payload.shareType !== "url" || payload.contentType !== "image" || !payload.contentUri || !extension) return [];
    if (size > MOBILE_ATTACHMENT_BYTES) return [];
    return [{ link: payload.value, uri: payload.contentUri, name: linkedImageName(payload.originalName, extension) }];
  });
}

async function download(folder: Directory, image: LinkedImage): Promise<SharedFile> {
  // A response can have no size. The download stops after the attachment limit, and the link stays.
  const controller = new AbortController();
  const file = await File.downloadFileAsync(image.uri, new File(folder, image.name), {
    idempotent: true,
    signal: controller.signal,
    onProgress: ({ bytesWritten }) => {
      if (bytesWritten > MOBILE_ATTACHMENT_BYTES) controller.abort();
    },
  });
  return sharedFile(file, image.name, folder);
}

/**
 * Reads the waiting share, moves its files into a folder of this share, and clears it, so a later
 * launch does not open it again. The folder of an earlier share goes first: its receiver has read it.
 */
export async function takeIncomingShare(): Promise<IncomingShare> {
  const payloads = sharedPayloads();
  // Android reads the share from its intent, so both reads come before the share is cleared.
  const sources = await sourceFiles(payloads);
  const images = await linkedImages(payloads);
  clearShare();
  const root = new Directory(Paths.cache, SHARE_FOLDER);
  if (root.exists) root.delete();
  const folder = new Directory(root, Crypto.randomUUID());
  folder.create({ intermediates: true });
  const files: SharedFile[] = [];
  for (const source of sources) {
    try {
      files.push(await moveInto(folder, source));
    } catch {
      // The receiver reports a file it cannot read, with its name.
      files.push({ uri: source.uri, name: source.name, size: null });
    }
  }
  // A link whose image came replaces its address, as in Messages. A failed download keeps the link.
  const replacedLinks = new Set<string>();
  for (const image of images) {
    try {
      files.push(await download(folder, image));
      replacedLinks.add(image.link);
    } catch {
      // The link stays in the text.
    }
  }
  const text = [
    ...new Set(
      payloads
        .filter((payload) => isTextPayload(payload) && !replacedLinks.has(payload.value))
        .map((payload) => payload.value.trim())
        .filter(Boolean),
    ),
  ].join("\n");
  return { text, files, folder: folder.uri };
}

/** Drops a waiting share without reading it, with the copies that the iOS extension made. */
export function discardWaitingShare(): void {
  const payloads = sharedPayloads();
  clearShare();
  // Android copies nothing before the share is read.
  if (isAndroid) return;
  for (const payload of payloads) {
    if (isTextPayload(payload)) continue;
    try {
      new File(payload.value).delete();
    } catch {
      // The App Group copy stays until the next share with that name.
    }
  }
}

/** Deletes the copies of a share that nobody received. */
export function discardIncomingShare(share: IncomingShare): void {
  try {
    const folder = new Directory(share.folder);
    if (folder.exists) folder.delete();
  } catch {
    // The cache is the system's to clear.
  }
}
