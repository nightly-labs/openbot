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

interface SharedFile {
  uri: string;
  name: string;
  size: number | null;
}

export interface IncomingShare {
  text: string;
  files: SharedFile[];
  folder: string;
}

const SHARE_FOLDER = "incoming-share";

const LINKED_IMAGE_EXTENSIONS: Readonly<Record<string, string>> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/gif": "gif",
  "image/webp": "webp",
  "image/avif": "avif",
  "image/heic": "heic",
  "image/heif": "heif",
};

interface LinkedImage {
  link: string;
  uri: string;
  name: string;
}

function sharedPayloads(): SharePayload[] {
  try {
    return getSharedPayloads();
  } catch {
    return [];
  }
}

function clearShare(): void {
  try {
    clearSharedPayloads();
  } catch {}
}

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

async function sourceFiles(payloads: SharePayload[]): Promise<{ uri: string; name: string }[]> {
  const files = payloads.filter((payload) => !isTextPayload(payload));
  if (files.length === 0) return [];
  if (!isAndroid) return files.map((payload) => ({ uri: payload.value, name: fileName(payload.value) }));
  const resolved = await getResolvedSharedPayloadsAsync();
  return resolved.flatMap((payload) =>
    payload.contentUri ? [{ uri: payload.contentUri, name: payload.originalName ?? fileName(payload.contentUri) }] : [],
  );
}

async function compatibleImage(file: File, name: string, folder: Directory): Promise<SharedFile> {
  const image = await ImageManipulator.manipulate(file.uri).renderAsync();
  const saved = await image.saveAsync({ format: SaveFormat.JPEG, compress: 0.9 });
  const jpeg = new File(saved.uri);
  const jpegName = `${name.replace(/\.(heic|heif)$/iu, "")}.jpg`;
  await jpeg.move(new File(folder, jpegName));
  file.delete();
  return { uri: jpeg.uri, name: jpegName, size: jpeg.size };
}

async function sharedFile(file: File, name: string, folder: Directory): Promise<SharedFile> {
  const kept = { uri: file.uri, name, size: file.exists ? file.size : null };
  if (!/\.(heic|heif)$/iu.test(name)) return kept;
  try {
    const smaller = await smallerPhoto(file.uri, name);
    if (smaller.uri !== file.uri) {
      const jpeg = new File(smaller.uri);
      await jpeg.move(new File(folder, smaller.name));
      file.delete();
      return { uri: jpeg.uri, name: smaller.name, size: jpeg.size };
    }
    return await compatibleImage(file, name, folder);
  } catch {
    return kept;
  }
}

async function moveInto(folder: Directory, source: { uri: string; name: string }): Promise<SharedFile> {
  const name = source.name.replace(/[/\\]/gu, "_") || "shared-file";
  const file = new File(source.uri);
  await file.move(new File(folder, name), { overwrite: true });
  return sharedFile(file, name, folder);
}

function linkedImageName(originalName: string | null, extension: string): string {
  const name = (originalName ?? "").replace(/[/\\]/gu, "_");
  const current = attachmentFileExtension(name);
  if (current === extension || (current === "jpeg" && extension === "jpg")) return name;
  return `${name.replace(/\.[^.]*$/u, "") || "image"}.${extension}`;
}

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

export async function takeIncomingShare(): Promise<IncomingShare> {
  const payloads = sharedPayloads();
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
      files.push({ uri: source.uri, name: source.name, size: null });
    }
  }
  const replacedLinks = new Set<string>();
  for (const image of images) {
    try {
      files.push(await download(folder, image));
      replacedLinks.add(image.link);
    } catch {}
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

export function discardWaitingShare(): void {
  const payloads = sharedPayloads();
  clearShare();
  if (isAndroid) return;
  for (const payload of payloads) {
    if (isTextPayload(payload)) continue;
    try {
      new File(payload.value).delete();
    } catch {}
  }
}

export function discardIncomingShare(share: IncomingShare): void {
  try {
    const folder = new Directory(share.folder);
    if (folder.exists) folder.delete();
  } catch {}
}
