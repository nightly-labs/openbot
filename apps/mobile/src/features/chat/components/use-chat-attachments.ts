import {
  type AttachmentSupport,
  attachmentFileExtension,
  attachmentMimeTypeForName,
  isSupportedAttachmentName,
  isSupportedAttachmentNameFor,
} from "@openbot/contracts/attachment-files";
import { INPUT_LIMITS } from "@openbot/contracts/input-limits";
import { TEAM_PROTOCOL_V2_MAX_FILE_BYTES } from "@openbot/contracts/team-protocol/v2";
import { bytesToBase64 } from "@openbot/team-client/base64";
import { MOBILE_ATTACHMENT_BYTES, type RemoteFileUpload } from "@openbot/team-client/remote-peer";
import * as Crypto from "expo-crypto";
import * as DocumentPicker from "expo-document-picker";
import { Directory, File, Paths } from "expo-file-system";
import * as ImagePicker from "expo-image-picker";
import { useMemo, useRef, useState } from "react";
import { attachmentSizeBucket } from "@/features/analytics/events";
import { showFailureAlert } from "@/features/analytics/failure-reports";
import { mobileAnalytics } from "@/features/analytics/mobile-analytics";
import { haptics } from "@/shared/lib/haptics";
import { isAndroid } from "@/shared/lib/platform";
import { readFileBase64 } from "@/shared/lib/read-file-base64";
import { useText } from "@/shared/lib/text";
import { type ImageDimensions, imageDimensions } from "../model/image-dimensions";
import { fileLimitText } from "../model/large-files";
import { smallerPhoto } from "../model/smaller-photo";

export interface ChatAttachmentAnchor {
  left: number;
  bottom: number;
  size: number;
  barStart: number;
  barTop: number;
}

export interface ChatAttachment extends RemoteFileUpload {
  id: string;
  size: number;
  uri?: string;
  dimensions?: ImageDimensions;
}

export const LARGE_TEXT_LENGTH = 4_000;

let sharedImagesCleared = false;

function deleteCopy(uri: string) {
  try {
    new File(uri).delete();
  } catch {}
}

async function keepSharedImage(file: RemoteFileUpload): Promise<string | undefined> {
  if (!isAndroid || !file.mimeType.startsWith("image/")) return undefined;
  const folder = new Directory(Paths.cache, "composer-images");
  if (!sharedImagesCleared) {
    sharedImagesCleared = true;
    try {
      if (folder.exists) folder.delete();
    } catch {}
  }
  try {
    folder.create({ intermediates: true, idempotent: true });
    const extension =
      file.name
        .split(".")
        .at(-1)
        ?.replace(/[^a-zA-Z0-9]/gu, "") || "img";
    const copy = new File(folder, `${Crypto.randomUUID()}.${extension}`);
    await copy.write(file.base64, { encoding: "base64" });
    return copy.uri;
  } catch {
    return undefined;
  }
}

let largeFilesCleared = false;

async function keepLargeFile(uri: string, name: string): Promise<string> {
  const folder = new Directory(Paths.cache, "composer-files");
  if (!largeFilesCleared) {
    largeFilesCleared = true;
    try {
      if (folder.exists) folder.delete();
    } catch {}
  }
  folder.create({ intermediates: true, idempotent: true });
  const extension =
    name
      .split(".")
      .at(-1)
      ?.replace(/[^a-zA-Z0-9]/gu, "") || "bin";
  const copy = new File(folder, `${Crypto.randomUUID()}.${extension}`);
  await new File(uri).copy(copy);
  return copy.uri;
}

export function useChatAttachments(
  initialItems: ChatAttachment[] = [],
  persist?: (items: ChatAttachment[]) => Promise<void>,
  support?: () => AttachmentSupport,
) {
  const text = useText();
  const { t, errorMessage } = text;
  const tooLarge = (name: string, bytes: number) =>
    new Error(t("mobile.chat.attachment.tooLarge", { name, limit: fileLimitText(text, bytes) }));
  const limitMessage = () => t("mobile.chat.attachment.limit", { limit: INPUT_LIMITS.attachments });
  const [menuAnchor, setMenuAnchor] = useState<ChatAttachmentAnchor | null>(null);
  const [items, setItems] = useState<ChatAttachment[]>(initialItems);
  const itemsRef = useRef<ChatAttachment[]>(initialItems);
  const preparingCount = useRef(0);
  const [preparing, setPreparing] = useState(false);
  function beginPreparing() {
    preparingCount.current += 1;
    if (preparingCount.current === 1) setPreparing(true);
  }
  function endPreparing() {
    preparingCount.current = Math.max(0, preparingCount.current - 1);
    if (preparingCount.current === 0) setPreparing(false);
  }
  const sequence = useRef(initialItems.reduce((max, item) => Math.max(max, Number(item.id.split("-").at(-1)) || 0), 0));
  function replace(next: ChatAttachment[]) {
    itemsRef.current = next;
    setItems(next);
  }
  async function persistItems(next: ChatAttachment[]) {
    if (persist) {
      beginPreparing();
      try {
        await persist(next);
      } finally {
        endPreparing();
      }
    }
    replace(next);
  }
  function assertSupported(name: string) {
    if (!support) {
      if (!isSupportedAttachmentName(name)) throw new Error(t("mobile.chat.attachment.unsupported", { name }));
    } else if (!isSupportedAttachmentNameFor(name, support())) {
      const type = attachmentFileExtension(name)?.toUpperCase();
      throw new Error(
        type
          ? t("mobile.chat.attachment.hostRejectsType", { name, type })
          : t("mobile.chat.attachment.hostRejects", { name }),
      );
    }
  }
  function prepare(input: RemoteFileUpload & { uri?: string }): ChatAttachment {
    assertSupported(input.name);
    if (!input.name.trim() || input.name.length > INPUT_LIMITS.attachmentName)
      throw new Error(t("mobile.chat.attachment.nameTooLong"));
    if (input.file) {
      if (input.file.size > TEAM_PROTOCOL_V2_MAX_FILE_BYTES)
        throw tooLarge(input.name, TEAM_PROTOCOL_V2_MAX_FILE_BYTES);
      return { ...input, size: input.file.size, id: `mobile-draft-attachment-${++sequence.current}` };
    }
    if (input.base64.length % 4 !== 0 || !/^[A-Za-z0-9+/]*={0,2}$/u.test(input.base64))
      throw new Error(t("mobile.chat.attachment.damaged"));
    const size =
      Math.floor((input.base64.length * 3) / 4) -
      (input.base64.endsWith("==") ? 2 : input.base64.endsWith("=") ? 1 : 0);
    if (size > MOBILE_ATTACHMENT_BYTES) throw tooLarge(input.name, MOBILE_ATTACHMENT_BYTES);
    const dimensions = input.mimeType.startsWith("image/") ? imageDimensions(input.base64) : null;
    return {
      ...input,
      size,
      id: `mobile-draft-attachment-${++sequence.current}`,
      ...(dimensions ? { dimensions } : {}),
    };
  }
  function trackSelected(size: number) {
    mobileAnalytics.track("attachment_action", {
      action: "select",
      result: "succeeded",
      attachment_count: 1,
      size_bucket: attachmentSizeBucket(size),
    });
  }
  function add(input: RemoteFileUpload & { uri?: string }) {
    if (itemsRef.current.length >= INPUT_LIMITS.attachments) throw new Error(limitMessage());
    const item = prepare(input);
    const saved = persistItems([...itemsRef.current, item]);
    trackSelected(item.size);
    return saved;
  }
  async function readFile(uri: string, name: string): Promise<RemoteFileUpload & { uri: string }> {
    const file = new File(uri);
    const safeName = name.replace(/[/\\]/gu, "_");
    const size = file.size;
    if (size > TEAM_PROTOCOL_V2_MAX_FILE_BYTES) throw tooLarge(safeName, TEAM_PROTOCOL_V2_MAX_FILE_BYTES);
    assertSupported(safeName);
    const mimeType = attachmentMimeTypeForName(safeName);
    if (size > MOBILE_ATTACHMENT_BYTES) return { name: safeName, mimeType, base64: "", uri, file: { ref: uri, size } };
    return { name: safeName, mimeType, base64: await readFileBase64(file), uri };
  }
  async function addFile(uri: string, name: string) {
    if (itemsRef.current.length >= INPUT_LIMITS.attachments) throw new Error(limitMessage());
    await add(await readFile(uri, name));
  }
  async function addPhotoFile(uri: string, name: string) {
    if (itemsRef.current.length >= INPUT_LIMITS.attachments) throw new Error(limitMessage());
    const photo = await smallerPhoto(uri, name);
    await addFile(photo.uri, photo.name);
  }
  function photoName(asset: ImagePicker.ImagePickerAsset) {
    const extension = asset.uri.split(".").at(-1)?.toLowerCase();
    const video = asset.type === "video";
    return asset.fileName && isSupportedAttachmentName(asset.fileName)
      ? asset.fileName
      : `${video ? "video" : "photo"}.${extension ?? (video ? "mov" : "jpg")}`;
  }
  function libraryMediaTypes(): ImagePicker.MediaType[] {
    const accepted = support?.();
    return !accepted || accepted.media || accepted.mp4 || accepted.anyFile ? ["images", "videos"] : ["images"];
  }
  async function replaceItem(id: string) {
    const current = itemsRef.current.find((item) => item.id === id);
    if (!current) return;
    let picked: { uri: string; name: string } | null = null;
    if (current.mimeType.startsWith("image/") && current.mimeType !== "image/svg+xml") {
      const result = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ["images"],
        quality: 1,
        preferredAssetRepresentationMode: ImagePicker.UIImagePickerPreferredAssetRepresentationMode.Compatible,
      });
      const asset = result.canceled ? undefined : result.assets[0];
      if (asset) picked = await smallerPhoto(asset.uri, photoName(asset));
    } else {
      const result = await DocumentPicker.getDocumentAsync({ multiple: false, copyToCacheDirectory: true });
      const asset = result.canceled ? undefined : result.assets[0];
      if (asset) picked = { uri: asset.uri, name: asset.name };
    }
    if (!picked) {
      mobileAnalytics.track("attachment_action", { action: "select", result: "cancelled", attachment_count: 0 });
      return;
    }
    const item = prepare(await readFile(picked.uri, picked.name));
    const next = itemsRef.current.map((candidate) => (candidate.id === id ? item : candidate));
    if (!next.includes(item)) return;
    await persistItems(next);
    trackSelected(item.size);
  }
  async function chooseFiles() {
    const result = await DocumentPicker.getDocumentAsync({ multiple: true, copyToCacheDirectory: true });
    if (!result.canceled) for (const asset of result.assets) await addFile(asset.uri, asset.name);
    else mobileAnalytics.track("attachment_action", { action: "select", result: "cancelled", attachment_count: 0 });
  }
  async function requestCamera(): Promise<boolean> {
    try {
      if (itemsRef.current.length >= INPUT_LIMITS.attachments) throw new Error(limitMessage());
      if (!(await ImagePicker.requestCameraPermissionsAsync()).granted)
        throw new Error(t("mobile.chat.attachment.cameraPermission"));
    } catch (error) {
      reportFailures([error]);
      return false;
    }
    return true;
  }
  async function choosePhotos() {
    if (itemsRef.current.length >= INPUT_LIMITS.attachments) throw new Error(limitMessage());
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: libraryMediaTypes(),
      allowsMultipleSelection: true,
      quality: 1,
      preferredAssetRepresentationMode: ImagePicker.UIImagePickerPreferredAssetRepresentationMode.Compatible,
      selectionLimit: INPUT_LIMITS.attachments - itemsRef.current.length,
    });
    if (result.canceled)
      mobileAnalytics.track("attachment_action", { action: "select", result: "cancelled", attachment_count: 0 });
    else
      for (const asset of result.assets)
        await (asset.type === "video" ? addFile : addPhotoFile)(asset.uri, photoName(asset));
  }
  function pasteText(text: string, onText: (text: string) => void) {
    if (text.length > LARGE_TEXT_LENGTH)
      return add({
        name: "pasted-text.txt",
        mimeType: "text/plain",
        base64: bytesToBase64(new TextEncoder().encode(text)),
      });
    onText(text);
  }
  function reportFailures(failures: unknown[]) {
    mobileAnalytics.track("attachment_action", {
      action: "select",
      result: "failed",
      failure_code: "operation_failed",
    });
    void haptics.notification("error");
    showFailureAlert(
      failures[0],
      "turn",
      t("mobile.chat.attachment.addFailed"),
      [...new Set(failures.map((error) => errorMessage(error, t("mobile.chat.tryAgain"))))].join("\n"),
    );
  }
  async function addShared(
    text: string,
    files: readonly { uri: string; name: string }[],
    onText: (text: string) => void,
  ): Promise<{ items: readonly ChatAttachment[]; refused: boolean }> {
    const large = text.length > LARGE_TEXT_LENGTH;
    if (text && !large) onText(text);
    if (!large && files.length === 0) return { items: itemsRef.current, refused: false };
    const failures: unknown[] = [];
    beginPreparing();
    try {
      if (large) {
        try {
          await add({
            name: "shared-text.txt",
            mimeType: "text/plain",
            base64: bytesToBase64(new TextEncoder().encode(text)),
          });
        } catch (error) {
          failures.push(error);
        }
      }
      for (const file of files) {
        try {
          if (itemsRef.current.length >= INPUT_LIMITS.attachments) throw new Error(limitMessage());
          const photo = await smallerPhoto(file.uri, file.name);
          const read = await readFile(photo.uri, photo.name)
            .then(async ({ uri, ...rest }) => {
              if (!rest.file) return rest;
              const copy = await keepLargeFile(uri, rest.name);
              return { ...rest, uri: copy, file: { ref: copy, size: rest.file.size } };
            })
            .finally(() => {
              if (photo.uri !== file.uri) deleteCopy(photo.uri);
            });
          if (read.file) await add(read);
          else {
            const { name, mimeType, base64 } = read;
            const uri = await keepSharedImage({ name, mimeType, base64 });
            await add({ name, mimeType, base64, ...(uri ? { uri } : {}) });
          }
        } catch (error) {
          failures.push(error);
        }
      }
    } finally {
      endPreparing();
    }
    if (failures.length > 0) reportFailures(failures);
    return { items: itemsRef.current, refused: failures.length > 0 };
  }
  const busyRef = useRef(false);
  function report(operation: () => Promise<void>) {
    if (busyRef.current) return;
    busyRef.current = true;
    beginPreparing();
    return operation()
      .catch((error) => reportFailures([error]))
      .finally(() => {
        busyRef.current = false;
        endPreparing();
      });
  }
  const actions = {
    openMenu: (anchor: ChatAttachmentAnchor) => setMenuAnchor(anchor),
    closeMenu: () => setMenuAnchor(null),
    addPhoto: (uri: string) => report(() => addPhotoFile(uri, "photo.jpg")),
    choosePhotos: () => report(choosePhotos),
    requestCamera,
    chooseFiles: () => report(chooseFiles),
    replace: (id: string) => report(() => replaceItem(id)),
    pasteText,
    addShared,
    remove: (id: string) => {
      void report(() => persistItems(itemsRef.current.filter((item) => item.id !== id)));
      mobileAnalytics.track("attachment_action", { action: "remove", result: "succeeded", attachment_count: 1 });
    },
    clear: () => replace([]),
    restore: (files: readonly ChatAttachment[]) =>
      replace([
        ...itemsRef.current,
        ...files.map((file) => ({ ...file, id: `mobile-draft-attachment-${++sequence.current}` })),
      ]),
  };
  const latestActions = useRef(actions);
  latestActions.current = actions;
  const [stableActions] = useState(() => ({
    openMenu: (anchor: ChatAttachmentAnchor) => latestActions.current.openMenu(anchor),
    closeMenu: () => latestActions.current.closeMenu(),
    addPhoto: (uri: string) => latestActions.current.addPhoto(uri),
    choosePhotos: () => latestActions.current.choosePhotos(),
    requestCamera: () => latestActions.current.requestCamera(),
    chooseFiles: () => latestActions.current.chooseFiles(),
    replace: (id: string) => latestActions.current.replace(id),
    pasteText: (text: string, onText: (text: string) => void) => latestActions.current.pasteText(text, onText),
    addShared: (text: string, files: readonly { uri: string; name: string }[], onText: (text: string) => void) =>
      latestActions.current.addShared(text, files, onText),
    remove: (id: string) => latestActions.current.remove(id),
    clear: () => latestActions.current.clear(),
    restore: (files: readonly ChatAttachment[]) => latestActions.current.restore(files),
  }));
  return useMemo(
    () => ({ items, preparing, menuAnchor, menuOpen: menuAnchor !== null, ...stableActions }),
    [items, preparing, menuAnchor, stableActions],
  );
}

export type ChatAttachments = ReturnType<typeof useChatAttachments>;
