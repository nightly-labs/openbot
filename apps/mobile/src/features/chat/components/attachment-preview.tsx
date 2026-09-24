import { attachmentFileExtension } from "@openbot/contracts/attachment-files";
import type { AttachmentSummary } from "@openbot/contracts/ipc";
import { MOBILE_ATTACHMENT_BYTES, type RemoteFileUpload } from "@openbot/team-client/remote-peer";
import { useQuery } from "@tanstack/react-query";
import { File, Paths } from "expo-file-system";
import { Image } from "expo-image";
import * as Sharing from "expo-sharing";
import { useThemeColor } from "heroui-native/hooks";
import { FileText } from "lucide-react-native";
import { useMemo, useState } from "react";
import { Alert, View } from "react-native";
import { useMobileWorkspace } from "@/features/workspace/context/mobile-workspace-context";
import { createImageDimensionCache } from "../model/image-dimension-cache";
import { type ImageDimensions, imageDimensions } from "../model/image-dimensions";

// Sizes outlive the downloaded file and the launch. A chat that scrolls an image back into view,
// or opens again, then reserves its real shape at once instead of a guess.
const dimensionCache = createImageDimensionCache({
  read: () => {
    const file = new File(Paths.cache, "chat-image-dimensions-v1.json");
    return file.exists ? file.textSync() : null;
  },
  write: (text) => new File(Paths.cache, "chat-image-dimensions-v1.json").write(text),
});

export function rememberImageDimensions(id: string, dimensions: ImageDimensions) {
  dimensionCache.remember(id, dimensions);
}

export function knownImageDimensions(id: string): ImageDimensions | null {
  return dimensionCache.get(id);
}

/** The short type a file card shows, such as PDF or CSV, from the name the user sees. */
export function attachmentTypeLabel(name: string, mimeType: string): string {
  const extension = attachmentFileExtension(name);
  if (extension && extension.length <= 5) return extension.toUpperCase();
  if (mimeType.startsWith("text/")) return "TEXT";
  return "FILE";
}

/** A list entry shows what the file is: an image shows itself, every other file shows its icon. */
export function AttachmentThumbnail({ name, uri, size = 40 }: { name: string; uri: string | null; size?: number }) {
  const fileColor = useThemeColor("success");
  return (
    <View
      className="items-center justify-center overflow-hidden rounded-xl bg-success/15"
      style={{ width: size, height: size }}
    >
      {uri ? (
        <Image
          source={uri}
          contentFit="cover"
          transition={120}
          accessibilityLabel={name}
          style={{ width: size, height: size }}
        />
      ) : (
        <FileText size={Math.round(size / 2)} color={String(fileColor)} />
      )}
    </View>
  );
}

/** The image of a file this phone holds itself, such as one an edit just added. */
export function localAttachmentPreview(file: { mimeType: string; base64: string; uri?: string }): string | null {
  if (!file.mimeType.startsWith("image/")) return null;
  return file.uri ?? (file.base64 ? `data:${file.mimeType};base64,${file.base64}` : null);
}

/**
 * One host file: its image for a preview, and the share sheet for opening it. The query key is the
 * one the chat uses, so a file read in a message is not downloaded a second time for a queue row.
 */
export function useAttachmentFile(serverId: string, attachment: AttachmentSummary, preview: boolean) {
  const { downloadAttachment } = useMobileWorkspace();
  const [sharing, setSharing] = useState(false);
  const pending = attachment.id.startsWith("mobile-draft-attachment-");
  const local =
    attachment.previewUrl?.startsWith("data:image/") || (pending && attachment.previewUrl?.startsWith("file://"))
      ? attachment.previewUrl
      : null;
  const query = useQuery({
    queryKey: ["chat-attachment", serverId, attachment.id],
    queryFn: (): Promise<RemoteFileUpload & { localUri?: string }> => {
      if (attachment.size > MOBILE_ATTACHMENT_BYTES)
        throw new Error("This file exceeds the mobile 10 MB limit. Open it on desktop.");
      return downloadAttachment(serverId, attachment.id);
    },
    enabled: preview && !local && !pending,
    retry: false,
    staleTime: Infinity,
    gcTime: 5 * 60 * 1000,
  });
  const data = query.data;
  const dimensions = useMemo(() => {
    const known = dimensionCache.get(attachment.id);
    if (known || !data?.mimeType.startsWith("image/")) return known ?? null;
    const read = imageDimensions(data.base64);
    if (read) rememberImageDimensions(attachment.id, read);
    return read;
  }, [attachment.id, data]);
  const localUri = local ?? query.data?.localUri;
  const uri = localUri ?? (query.data ? `data:${query.data.mimeType};base64,${query.data.base64}` : null);
  async function share() {
    setSharing(true);
    let file: File | null = null;
    try {
      if (!(await Sharing.isAvailableAsync())) throw new Error("File sharing is unavailable on this device.");
      const result = query.data ? { data: query.data, error: null } : await query.refetch();
      if (result.error) throw result.error;
      if (!result.data) throw new Error("The attachment is unavailable. Try again.");
      const name = attachment.name.replace(/[/\\\p{Cc}]/gu, "_");
      file = new File(Paths.cache, `${Date.now()}-${name}`);
      file.write(result.data.base64, { encoding: "base64" });
      await Sharing.shareAsync(file.uri, { mimeType: result.data.mimeType, dialogTitle: attachment.name });
    } catch (error) {
      Alert.alert("Could not open attachment", error instanceof Error ? error.message : "Try again.");
    } finally {
      if (file?.exists) file.delete();
      setSharing(false);
    }
  }
  /** Saves the image to the photo library. It reports its own failure and returns whether it saved. */
  async function saveToPhotos(): Promise<boolean> {
    setSharing(true);
    let file: File | null = null;
    try {
      // Loaded on use: an app build made before this module was added has no native side for it,
      // and a top-level import would break every chat instead of this one action.
      const MediaLibrary = await import("expo-media-library").catch(() => null);
      if (!MediaLibrary) throw new Error("Saving photos needs the latest version of the app.");
      if (!(await MediaLibrary.requestPermissionsAsync(true, ["photo"])).granted)
        throw new Error("Allow OpenBot to add photos in Settings to save this image.");
      const result = query.data ? { data: query.data, error: null } : await query.refetch();
      if (result.error) throw result.error;
      if (!result.data) throw new Error("The image is unavailable. Try again.");
      // The photo library reads the type from the extension, so the file keeps one.
      const extension = attachmentFileExtension(attachment.name) ?? result.data.mimeType.split("/")[1] ?? "png";
      file = new File(Paths.cache, `${Date.now()}-download.${extension}`);
      file.write(result.data.base64, { encoding: "base64" });
      await MediaLibrary.Asset.create(file.uri);
      return true;
    } catch (error) {
      Alert.alert("Could not save image", error instanceof Error ? error.message : "Try again.");
      return false;
    } finally {
      if (file?.exists) file.delete();
      setSharing(false);
    }
  }
  return {
    pending,
    localUri,
    uri,
    dimensions,
    saveToPhotos,
    query,
    sharing,
    busy: sharing || query.isFetching,
    share: () => void share(),
  };
}

/**
 * Opens a file this phone holds in the share sheet, where the user can view it in another app
 * before sending. A pasted file has no path, so it gets a temporary one that is removed after.
 */
export async function shareLocalAttachment(file: { name: string; mimeType: string; base64: string; uri?: string }) {
  let temporary: File | null = null;
  try {
    if (!(await Sharing.isAvailableAsync())) throw new Error("File sharing is unavailable on this device.");
    let uri = file.uri;
    if (!uri) {
      temporary = new File(Paths.cache, `${Date.now()}-${file.name.replace(/[/\\\p{Cc}]/gu, "_")}`);
      temporary.write(file.base64, { encoding: "base64" });
      uri = temporary.uri;
    }
    await Sharing.shareAsync(uri, { mimeType: file.mimeType, dialogTitle: file.name });
  } catch (error) {
    Alert.alert("Could not open attachment", error instanceof Error ? error.message : "Try again.");
  } finally {
    if (temporary?.exists) temporary.delete();
  }
}

export function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(1)} GB`;
}
