import { INPUT_LIMITS } from "@openbot/contracts/input-limits";
import { MOBILE_ATTACHMENT_BYTES, type RemoteFileUpload } from "@openbot/team-client/remote-peer";
import type * as Clipboard from "expo-clipboard";
import * as DocumentPicker from "expo-document-picker";
import { File } from "expo-file-system";
import { useRef, useState } from "react";
import { Alert } from "react-native";

//! Enable when mobile file transfer is ready.
export const CHAT_ATTACHMENTS_ENABLED = false;

export interface ChatAttachment extends RemoteFileUpload {
  id: string;
  size: number;
}

function base64(bytes: Uint8Array) {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

export function useChatAttachments() {
  const [items, setItems] = useState<ChatAttachment[]>([]);
  const itemsRef = useRef<ChatAttachment[]>([]);
  const sequence = useRef(0);
  function replace(next: ChatAttachment[]) {
    itemsRef.current = next;
    setItems(next);
  }
  function add(input: RemoteFileUpload) {
    const size =
      Math.floor((input.base64.length * 3) / 4) -
      (input.base64.endsWith("==") ? 2 : input.base64.endsWith("=") ? 1 : 0);
    if (size > MOBILE_ATTACHMENT_BYTES) throw new Error("Attachments must be 10 MB or smaller.");
    if (itemsRef.current.length >= INPUT_LIMITS.attachments) throw new Error("You can attach up to 10 files.");
    const item = { ...input, size, id: `attachment-${++sequence.current}` };
    replace([...itemsRef.current, item]);
  }
  async function addFile(uri: string, name: string, mimeType: string) {
    const file = new File(uri);
    if (file.size > MOBILE_ATTACHMENT_BYTES) throw new Error("Attachments must be 10 MB or smaller.");
    add({ name: name.replace(/[/\\]/gu, "_"), mimeType, base64: base64(await file.bytes()) });
  }
  async function chooseFiles() {
    if (!CHAT_ATTACHMENTS_ENABLED) {
      Alert.alert("Coming soon", "File attachments will be available in a future update.");
      return;
    }
    const result = await DocumentPicker.getDocumentAsync({ multiple: true, copyToCacheDirectory: true });
    if (!result.canceled)
      for (const asset of result.assets)
        await addFile(asset.uri, asset.name, asset.mimeType ?? "application/octet-stream");
  }
  function paste(data: Clipboard.PasteEventPayload, onText: (text: string) => void) {
    if (data.type === "image")
      add({ name: "pasted-image.png", mimeType: "image/png", base64: data.data.slice(data.data.indexOf(",") + 1) });
    else if (data.text.length > 4_000)
      add({ name: "pasted-text.txt", mimeType: "text/plain", base64: base64(new TextEncoder().encode(data.text)) });
    else onText(data.text);
  }
  function report(operation: () => Promise<void>) {
    void operation().catch((error) =>
      Alert.alert("Could not add attachment", error instanceof Error ? error.message : "Try again."),
    );
  }
  return {
    items,
    chooseFiles: () => report(chooseFiles),
    paste,
    remove: (id: string) => replace(itemsRef.current.filter((item) => item.id !== id)),
    clear: () => replace([]),
  };
}

export type ChatAttachments = ReturnType<typeof useChatAttachments>;
