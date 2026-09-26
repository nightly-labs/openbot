import {
  type AttachmentSupport,
  attachmentFileExtension,
  attachmentMimeTypeForName,
  isSupportedAttachmentName,
  isSupportedAttachmentNameFor,
} from "@openbot/contracts/attachment-files";
import { INPUT_LIMITS } from "@openbot/contracts/input-limits";
import { MOBILE_ATTACHMENT_BYTES, type RemoteFileUpload } from "@openbot/team-client/remote-peer";
import type * as Clipboard from "expo-clipboard";
import * as DocumentPicker from "expo-document-picker";
import { File } from "expo-file-system";
import * as ImagePicker from "expo-image-picker";
import { useRef, useState } from "react";
import { Alert } from "react-native";
import { attachmentSizeBucket } from "@/features/analytics/events";
import { mobileAnalytics } from "@/features/analytics/mobile-analytics";
import { useText } from "@/shared/lib/text";
import { type ImageDimensions, imageDimensions } from "../model/image-dimensions";

/**
 * Where the plus is drawn, from the screen's left and bottom edges. Measuring
 * it is not an option: `measureInWindow` reads the layout tree, and both the
 * plus and the composer around it carry Reanimated transforms that never reach
 * it. The composer computes this from the same numbers it draws with.
 */
export interface ChatAttachmentAnchor {
  left: number;
  bottom: number;
  size: number;
}

export interface ChatAttachment extends RemoteFileUpload {
  id: string;
  size: number;
  uri?: string;
  /** Read from the image header when the file is chosen, so every view reserves its shape. */
  dimensions?: ImageDimensions;
}

function base64(bytes: Uint8Array) {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

export function useChatAttachments(
  initialItems: ChatAttachment[] = [],
  persist?: (items: ChatAttachment[]) => Promise<void>,
  /** What the receiving host accepts. Read on each selection, because it loads with the connection. */
  support?: () => AttachmentSupport,
) {
  const { t } = useText();
  const limitMessage = () => t("mobile.chat.attachment.limit", { limit: INPUT_LIMITS.attachments });
  // The plus's rect while the attachment card is open, and null while it is
  // not: one value, so the card can never be open without an anchor to grow
  // out of and collapse back into.
  const [menuAnchor, setMenuAnchor] = useState<ChatAttachmentAnchor | null>(null);
  const [items, setItems] = useState<ChatAttachment[]>(initialItems);
  const itemsRef = useRef<ChatAttachment[]>(initialItems);
  // Selection reads files one by one while persistence runs per file. A plain
  // flag cleared by an inner persist would report idle during the next read,
  // so count nested preparation instead.
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
  // The same checks as desktop, named per file: one selection can hold several, and the user
  // needs to know which one to fix.
  function assertSupported(name: string) {
    if (!isSupportedAttachmentName(name)) throw new Error(t("mobile.chat.attachment.unsupported", { name }));
    if (support && !isSupportedAttachmentNameFor(name, support())) {
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
    if (input.base64.length % 4 !== 0 || !/^[A-Za-z0-9+/]*={0,2}$/u.test(input.base64))
      throw new Error(t("mobile.chat.attachment.damaged"));
    const size =
      Math.floor((input.base64.length * 3) / 4) -
      (input.base64.endsWith("==") ? 2 : input.base64.endsWith("=") ? 1 : 0);
    if (size > MOBILE_ATTACHMENT_BYTES) throw new Error(t("mobile.chat.attachment.tooLarge", { name: input.name }));
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
    // Check before reading: a rejected file should not be copied into memory first.
    if (file.size > MOBILE_ATTACHMENT_BYTES) throw new Error(t("mobile.chat.attachment.tooLarge", { name: safeName }));
    assertSupported(safeName);
    return { name: safeName, mimeType: attachmentMimeTypeForName(safeName), base64: await file.base64(), uri };
  }
  async function addFile(uri: string, name: string) {
    if (itemsRef.current.length >= INPUT_LIMITS.attachments) throw new Error(limitMessage());
    await add(await readFile(uri, name));
  }
  function photoName(asset: ImagePicker.ImagePickerAsset) {
    const extension = asset.uri.split(".").at(-1)?.toLowerCase();
    return asset.fileName && isSupportedAttachmentName(asset.fileName) ? asset.fileName : `photo.${extension ?? "jpg"}`;
  }
  /** Swap one file in place. The rest keep their order, and a cancelled picker changes nothing. */
  async function replaceItem(id: string) {
    const current = itemsRef.current.find((item) => item.id === id);
    if (!current) return;
    let picked: { uri: string; name: string } | null = null;
    if (current.mimeType.startsWith("image/")) {
      const result = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ["images"],
        quality: 1,
        preferredAssetRepresentationMode: ImagePicker.UIImagePickerPreferredAssetRepresentationMode.Compatible,
      });
      const asset = result.canceled ? undefined : result.assets[0];
      if (asset) picked = { uri: asset.uri, name: photoName(asset) };
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
    // The list can change while the picker is open; replace the file where it is now.
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
  // Answers whether the card may become the camera. It reports its own refusal
  // rather than throwing: the card stays open on a refusal, so there is nothing
  // for the caller's error path to unwind.
  async function requestCamera(): Promise<boolean> {
    try {
      if (itemsRef.current.length >= INPUT_LIMITS.attachments) throw new Error(limitMessage());
      if (!(await ImagePicker.requestCameraPermissionsAsync()).granted)
        throw new Error(t("mobile.chat.attachment.cameraPermission"));
    } catch (error) {
      mobileAnalytics.track("attachment_action", {
        action: "select",
        result: "failed",
        failure_code: "operation_failed",
      });
      Alert.alert(
        t("mobile.chat.attachment.addFailed"),
        error instanceof Error ? error.message : t("mobile.chat.tryAgain"),
      );
      return false;
    }
    return true;
  }
  async function choosePhotos() {
    if (itemsRef.current.length >= INPUT_LIMITS.attachments) throw new Error(limitMessage());
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ["images"],
      allowsMultipleSelection: true,
      quality: 1,
      preferredAssetRepresentationMode: ImagePicker.UIImagePickerPreferredAssetRepresentationMode.Compatible,
      selectionLimit: INPUT_LIMITS.attachments - itemsRef.current.length,
    });
    if (result.canceled)
      mobileAnalytics.track("attachment_action", { action: "select", result: "cancelled", attachment_count: 0 });
    else for (const asset of result.assets) await addFile(asset.uri, photoName(asset));
  }
  function paste(data: Clipboard.PasteEventPayload, onText: (text: string) => void) {
    if (data.type === "image")
      return add({
        name: "pasted-image.png",
        mimeType: "image/png",
        base64: data.data.slice(data.data.indexOf(",") + 1),
      });
    else if (data.text.length > 4_000)
      return add({
        name: "pasted-text.txt",
        mimeType: "text/plain",
        base64: base64(new TextEncoder().encode(data.text)),
      });
    else onText(data.text);
  }
  const busyRef = useRef(false);
  function report(operation: () => Promise<void>) {
    if (busyRef.current) return;
    busyRef.current = true;
    beginPreparing();
    return operation()
      .catch((error) => {
        mobileAnalytics.track("attachment_action", {
          action: "select",
          result: "failed",
          failure_code: "operation_failed",
        });
        Alert.alert(
          t("mobile.chat.attachment.addFailed"),
          error instanceof Error ? error.message : t("mobile.chat.tryAgain"),
        );
      })
      .finally(() => {
        busyRef.current = false;
        endPreparing();
      });
  }
  return {
    items,
    preparing,
    menuAnchor,
    menuOpen: menuAnchor !== null,
    openMenu: (anchor: ChatAttachmentAnchor) => setMenuAnchor(anchor),
    closeMenu: () => setMenuAnchor(null),
    // Held after the card has left, so the file read, the base64 encode and
    // the composer's re-render do not land on the frames of its exit. It
    // reports its own failure, because by then there is no card to show one in.
    addPhoto: (uri: string) => report(() => addFile(uri, "photo.jpg")),
    choosePhotos: () => report(choosePhotos),
    requestCamera,
    chooseFiles: () => report(chooseFiles),
    replace: (id: string) => report(() => replaceItem(id)),
    paste,
    remove: (id: string) => {
      void report(() => persistItems(itemsRef.current.filter((item) => item.id !== id)));
      mobileAnalytics.track("attachment_action", { action: "remove", result: "succeeded", attachment_count: 1 });
    },
    clear: () => replace([]),
  };
}

export type ChatAttachments = ReturnType<typeof useChatAttachments>;
