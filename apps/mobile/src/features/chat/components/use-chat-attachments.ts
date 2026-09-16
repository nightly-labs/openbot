import {
  attachmentMimeTypeForName,
  isSupportedAttachmentName,
  SUPPORTED_ATTACHMENT_DESCRIPTION,
} from "@openbot/contracts/attachment-files";
import { INPUT_LIMITS } from "@openbot/contracts/input-limits";
import { MOBILE_ATTACHMENT_BYTES, type RemoteFileUpload } from "@openbot/team-client/remote-peer";
import type * as Clipboard from "expo-clipboard";
import * as DocumentPicker from "expo-document-picker";
import { File } from "expo-file-system";
import * as ImagePicker from "expo-image-picker";
import { useRef, useState } from "react";
import { Alert, Keyboard } from "react-native";
import { attachmentSizeBucket } from "@/features/analytics/events";
import { mobileAnalytics } from "@/features/analytics/mobile-analytics";

export interface ChatCameraOrigin {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface ChatAttachment extends RemoteFileUpload {
  id: string;
  size: number;
  uri?: string;
}

function base64(bytes: Uint8Array) {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

export function useChatAttachments(
  initialItems: ChatAttachment[] = [],
  persist?: (items: ChatAttachment[]) => Promise<void>,
) {
  const [cameraOpen, setCameraOpen] = useState(false);
  const [cameraOrigin, setCameraOrigin] = useState<ChatCameraOrigin>();
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
  function add(input: RemoteFileUpload & { uri?: string }) {
    if (!isSupportedAttachmentName(input.name)) throw new Error(`Choose ${SUPPORTED_ATTACHMENT_DESCRIPTION}.`);
    if (!input.name.trim() || input.name.length > INPUT_LIMITS.attachmentName)
      throw new Error("Choose a file with a shorter name.");
    if (input.base64.length % 4 !== 0 || !/^[A-Za-z0-9+/]*={0,2}$/u.test(input.base64))
      throw new Error("The attachment is damaged. Select it again.");
    const size =
      Math.floor((input.base64.length * 3) / 4) -
      (input.base64.endsWith("==") ? 2 : input.base64.endsWith("=") ? 1 : 0);
    if (size > MOBILE_ATTACHMENT_BYTES) throw new Error("Attachments must be 10 MB or smaller.");
    if (itemsRef.current.length >= INPUT_LIMITS.attachments) throw new Error("You can attach up to 10 files.");
    const item = { ...input, size, id: `mobile-draft-attachment-${++sequence.current}` };
    const saved = persistItems([...itemsRef.current, item]);
    mobileAnalytics.track("attachment_action", {
      action: "select",
      result: "succeeded",
      attachment_count: 1,
      size_bucket: attachmentSizeBucket(size),
    });
    return saved;
  }
  async function addFile(uri: string, name: string) {
    if (itemsRef.current.length >= INPUT_LIMITS.attachments) throw new Error("You can attach up to 10 files.");
    const file = new File(uri);
    if (file.size > MOBILE_ATTACHMENT_BYTES) throw new Error("Attachments must be 10 MB or smaller.");
    const safeName = name.replace(/[/\\]/gu, "_");
    if (!isSupportedAttachmentName(safeName)) throw new Error(`Choose ${SUPPORTED_ATTACHMENT_DESCRIPTION}.`);
    await add({ name: safeName, mimeType: attachmentMimeTypeForName(safeName), base64: await file.base64(), uri });
  }
  async function chooseFiles() {
    const result = await DocumentPicker.getDocumentAsync({ multiple: true, copyToCacheDirectory: true });
    if (!result.canceled) for (const asset of result.assets) await addFile(asset.uri, asset.name);
    else mobileAnalytics.track("attachment_action", { action: "select", result: "cancelled", attachment_count: 0 });
  }
  async function openCamera(origin?: ChatCameraOrigin) {
    if (itemsRef.current.length >= INPUT_LIMITS.attachments) throw new Error("You can attach up to 10 files.");
    if (!(await ImagePicker.requestCameraPermissionsAsync()).granted)
      throw new Error("Allow camera access in Settings to take a photo.");
    Keyboard.dismiss();
    setCameraOrigin(origin);
    setCameraOpen(true);
  }
  async function choosePhotos() {
    if (itemsRef.current.length >= INPUT_LIMITS.attachments) throw new Error("You can attach up to 10 files.");
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ["images"],
      allowsMultipleSelection: true,
      quality: 1,
      preferredAssetRepresentationMode: ImagePicker.UIImagePickerPreferredAssetRepresentationMode.Compatible,
      selectionLimit: INPUT_LIMITS.attachments - itemsRef.current.length,
    });
    if (result.canceled)
      mobileAnalytics.track("attachment_action", { action: "select", result: "cancelled", attachment_count: 0 });
    else
      for (const asset of result.assets) {
        const extension = asset.uri.split(".").at(-1)?.toLowerCase();
        const name =
          asset.fileName && isSupportedAttachmentName(asset.fileName) ? asset.fileName : `photo.${extension ?? "jpg"}`;
        await addFile(asset.uri, name);
      }
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
        Alert.alert("Could not add attachment", error instanceof Error ? error.message : "Try again.");
      })
      .finally(() => {
        busyRef.current = false;
        endPreparing();
      });
  }
  return {
    items,
    preparing,
    cameraOpen,
    cameraOrigin,
    closeCamera: () => setCameraOpen(false),
    addPhoto: async (uri: string) => {
      await addFile(uri, "photo.jpg");
      setCameraOpen(false);
    },
    choosePhotos: () => report(choosePhotos),
    takePhoto: (origin?: ChatCameraOrigin) => report(() => openCamera(origin)),
    chooseFiles: () => report(chooseFiles),
    paste,
    remove: (id: string) => {
      void report(() => persistItems(itemsRef.current.filter((item) => item.id !== id)));
      mobileAnalytics.track("attachment_action", { action: "remove", result: "succeeded", attachment_count: 1 });
    },
    clear: () => replace([]),
  };
}

export type ChatAttachments = ReturnType<typeof useChatAttachments>;
