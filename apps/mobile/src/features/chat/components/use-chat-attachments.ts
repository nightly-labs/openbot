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

export function useChatAttachments() {
  const [cameraOpen, setCameraOpen] = useState(false);
  const [items, setItems] = useState<ChatAttachment[]>([]);
  const itemsRef = useRef<ChatAttachment[]>([]);
  const sequence = useRef(0);
  function replace(next: ChatAttachment[]) {
    itemsRef.current = next;
    setItems(next);
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
    replace([...itemsRef.current, item]);
  }
  async function addFile(uri: string, name: string) {
    if (itemsRef.current.length >= INPUT_LIMITS.attachments) throw new Error("You can attach up to 10 files.");
    const file = new File(uri);
    if (file.size > MOBILE_ATTACHMENT_BYTES) throw new Error("Attachments must be 10 MB or smaller.");
    const safeName = name.replace(/[/\\]/gu, "_");
    if (!isSupportedAttachmentName(safeName)) throw new Error(`Choose ${SUPPORTED_ATTACHMENT_DESCRIPTION}.`);
    add({ name: safeName, mimeType: attachmentMimeTypeForName(safeName), base64: await file.base64(), uri });
  }
  async function chooseFiles() {
    const result = await DocumentPicker.getDocumentAsync({ multiple: true, copyToCacheDirectory: true });
    if (!result.canceled) for (const asset of result.assets) await addFile(asset.uri, asset.name);
  }
  async function openCamera() {
    if (itemsRef.current.length >= INPUT_LIMITS.attachments) throw new Error("You can attach up to 10 files.");
    if (!(await ImagePicker.requestCameraPermissionsAsync()).granted)
      throw new Error("Allow camera access in Settings to take a photo.");
    Keyboard.dismiss();
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
    if (!result.canceled)
      for (const asset of result.assets) {
        const extension = asset.uri.split(".").at(-1)?.toLowerCase();
        const name =
          asset.fileName && isSupportedAttachmentName(asset.fileName) ? asset.fileName : `photo.${extension ?? "jpg"}`;
        await addFile(asset.uri, name);
      }
  }
  function paste(data: Clipboard.PasteEventPayload, onText: (text: string) => void) {
    if (data.type === "image")
      add({ name: "pasted-image.png", mimeType: "image/png", base64: data.data.slice(data.data.indexOf(",") + 1) });
    else if (data.text.length > 4_000)
      add({ name: "pasted-text.txt", mimeType: "text/plain", base64: base64(new TextEncoder().encode(data.text)) });
    else onText(data.text);
  }
  const busyRef = useRef(false);
  const [preparing, setPreparing] = useState(false);
  function report(operation: () => Promise<void>) {
    if (busyRef.current) return;
    busyRef.current = true;
    setPreparing(true);
    return operation()
      .catch((error) => Alert.alert("Could not add attachment", error instanceof Error ? error.message : "Try again."))
      .finally(() => {
        busyRef.current = false;
        setPreparing(false);
      });
  }
  return {
    items,
    preparing,
    cameraOpen,
    closeCamera: () => setCameraOpen(false),
    addPhoto: async (uri: string) => {
      await addFile(uri, "photo.jpg");
      setCameraOpen(false);
    },
    choosePhotos: () => report(choosePhotos),
    takePhoto: () => report(openCamera),
    chooseFiles: () => report(chooseFiles),
    paste,
    remove: (id: string) => replace(itemsRef.current.filter((item) => item.id !== id)),
    clear: () => replace([]),
  };
}

export type ChatAttachments = ReturnType<typeof useChatAttachments>;
