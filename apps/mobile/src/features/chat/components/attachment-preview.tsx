import { attachmentFileExtension } from "@openbot/contracts/attachment-files";
import type { AttachmentSummary } from "@openbot/contracts/ipc";
import type { MobileTranslate } from "@openbot/i18n/mobile";
import { MOBILE_ATTACHMENT_BYTES, type RemoteFileUpload } from "@openbot/team-client/remote-peer";
import { useQuery } from "@tanstack/react-query";
import { File, Paths } from "expo-file-system";
import { Image } from "expo-image";
import * as Sharing from "expo-sharing";
import { useThemeColor } from "heroui-native/hooks";
import FileText from "lucide-react-native/icons/file-text";
import { useMemo, useState } from "react";
import { View } from "react-native";
import { showFailureAlert } from "@/features/analytics/failure-reports";
import { useMobileWorkspaceActions } from "@/features/workspace/context/mobile-workspace-context";
import { queryKeys } from "@/features/workspace/model/query-keys";
import { haptics } from "@/shared/lib/haptics";
import { currentText, useText } from "@/shared/lib/text";
import { createImageDimensionCache } from "../model/image-dimension-cache";
import { type ImageDimensions, imageDimensions } from "../model/image-dimensions";
import { mediaFile } from "./use-media-file";

// Sizes outlive the downloaded file and the launch. A chat that scrolls an image back into view,
// or opens again, then reserves its real shape at once instead of a guess.
const dimensionCache = createImageDimensionCache({
  read: () => {
    const file = new File(Paths.cache, "chat-image-dimensions-v1.json");
    return file.exists ? file.textSync() : null;
  },
  write: (text) => new File(Paths.cache, "chat-image-dimensions-v1.json").writeSync(text),
});

export function rememberImageDimensions(id: string, dimensions: ImageDimensions) {
  dimensionCache.remember(id, dimensions);
}

/** The size of an image the phone has decoded or read before, or null. */
export function knownImageDimensions(id: string): ImageDimensions | null {
  return dimensionCache.get(id);
}

/** The short type a file card shows, such as PDF or CSV, from the name the user sees. */
export function attachmentTypeLabel(name: string, mimeType: string, t: MobileTranslate): string {
  const extension = attachmentFileExtension(name);
  if (extension && extension.length <= 5) return extension.toUpperCase();
  if (mimeType.startsWith("text/")) return t("mobile.chat.attachment.typeText");
  return t("mobile.chat.attachment.typeFile");
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
 * A downloaded image as a file in the chat media folder. The image view gets a short file URI, not
 * a data URL of many megabytes: Android Glide copies its source text, and a large data URL ran
 * the app out of memory. A file that cannot be written leaves the data URL.
 */
function keepImageFile(serverId: string, attachment: AttachmentSummary, data: RemoteFileUpload): string | undefined {
  try {
    const file = mediaFile(serverId, attachment);
    if (!file.exists || file.size !== attachment.size) {
      file.parentDirectory.create({ intermediates: true, idempotent: true });
      file.writeSync(data.base64, { encoding: "base64" });
    }
    return file.uri;
  } catch {
    return undefined;
  }
}

/**
 * An image that this launch downloaded before, as a file that is whole, when the phone also knows
 * its size. The chat then shows it again without a new download. Its data has no Base64.
 */
function keptImageFile(
  serverId: string,
  attachment: AttachmentSummary,
): (RemoteFileUpload & { fileUri: string }) | null {
  if (!attachment.mimeType.startsWith("image/") || !dimensionCache.get(attachment.id)) return null;
  try {
    const file = mediaFile(serverId, attachment);
    if (!file.exists || file.size !== attachment.size) return null;
    return { name: attachment.name, mimeType: attachment.mimeType, base64: "", fileUri: file.uri };
  } catch {
    return null;
  }
}

/** The Base64 of a file, read from its kept copy when the data has none. */
async function fileBase64(data: RemoteFileUpload & { fileUri?: string }): Promise<string> {
  if (data.base64 || !data.fileUri) return data.base64;
  return new File(data.fileUri).base64();
}

/**
 * One host file: its image for a preview, and the share sheet for opening it. The query key is the
 * one the chat uses, so a file read in a message is not downloaded a second time for a queue row.
 */
export function useAttachmentFile(serverId: string, attachment: AttachmentSummary, preview: boolean) {
  const { downloadAttachment } = useMobileWorkspaceActions();
  const { t, sourceText } = useText();
  const [sharing, setSharing] = useState(false);
  const pending = attachment.id.startsWith("mobile-draft-attachment-");
  const local =
    attachment.previewUrl?.startsWith("data:image/") || (pending && attachment.previewUrl?.startsWith("file://"))
      ? attachment.previewUrl
      : null;
  const query = useQuery({
    queryKey: queryKeys.chatAttachment(serverId, attachment.id),
    queryFn: async (): Promise<RemoteFileUpload & { localUri?: string; fileUri?: string }> => {
      if (attachment.size > MOBILE_ATTACHMENT_BYTES) throw new Error(t("mobile.chat.attachment.tooLargeForMobile"));
      const kept = keptImageFile(serverId, attachment);
      if (kept) return kept;
      const data = await downloadAttachment(serverId, attachment.id);
      return {
        ...data,
        fileUri: data.mimeType.startsWith("image/") ? keepImageFile(serverId, attachment, data) : undefined,
      };
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
  const uri =
    localUri ?? query.data?.fileUri ?? (query.data ? `data:${query.data.mimeType};base64,${query.data.base64}` : null);
  async function share() {
    setSharing(true);
    let file: File | null = null;
    try {
      if (!(await Sharing.isAvailableAsync())) throw new Error(t("mobile.chat.attachment.sharingUnavailable"));
      const result = query.data ? { data: query.data, error: null } : await query.refetch();
      if (result.error) throw result.error;
      if (!result.data) throw new Error(t("mobile.chat.attachment.unavailable"));
      const name = attachment.name.replace(/[/\\\p{Cc}]/gu, "_");
      file = new File(Paths.cache, `${Date.now()}-${name}`);
      file.writeSync(await fileBase64(result.data), { encoding: "base64" });
      await Sharing.shareAsync(file.uri, { mimeType: result.data.mimeType, dialogTitle: attachment.name });
    } catch (error) {
      void haptics.notification("error");
      showFailureAlert(
        error,
        "turn",
        t("mobile.chat.attachment.openFailed"),
        error instanceof Error ? sourceText(error.message) : t("mobile.chat.tryAgain"),
      );
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
      if (!MediaLibrary) throw new Error(t("mobile.chat.attachment.photosNeedUpdate"));
      if (!(await MediaLibrary.requestPermissionsAsync(true, ["photo"])).granted)
        throw new Error(t("mobile.chat.attachment.photosPermission"));
      const result = query.data ? { data: query.data, error: null } : await query.refetch();
      if (result.error) throw result.error;
      if (!result.data) throw new Error(t("mobile.chat.attachment.imageUnavailable"));
      // The photo library reads the type from the extension, so the file keeps one.
      const extension = attachmentFileExtension(attachment.name) ?? result.data.mimeType.split("/")[1] ?? "png";
      file = new File(Paths.cache, `${Date.now()}-download.${extension}`);
      file.writeSync(await fileBase64(result.data), { encoding: "base64" });
      await MediaLibrary.Asset.create(file.uri);
      return true;
    } catch (error) {
      void haptics.notification("error");
      showFailureAlert(
        error,
        "turn",
        t("mobile.chat.attachment.saveImageFailed"),
        error instanceof Error ? sourceText(error.message) : t("mobile.chat.tryAgain"),
      );
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
 * before sending, or save a file that the chat downloaded. A pasted file has no path, so it gets a temporary one that is removed after.
 */
export async function shareLocalAttachment(file: { name: string; mimeType: string; base64?: string; uri?: string }) {
  const { t, sourceText } = currentText();
  let temporary: File | null = null;
  try {
    if (!(await Sharing.isAvailableAsync())) throw new Error(t("mobile.chat.attachment.sharingUnavailable"));
    let uri = file.uri;
    if (!uri) {
      if (!file.base64) throw new Error(t("mobile.chat.attachment.unavailable"));
      temporary = new File(Paths.cache, `${Date.now()}-${file.name.replace(/[/\\\p{Cc}]/gu, "_")}`);
      temporary.writeSync(file.base64, { encoding: "base64" });
      uri = temporary.uri;
    }
    await Sharing.shareAsync(uri, { mimeType: file.mimeType, dialogTitle: file.name });
  } catch (error) {
    void haptics.notification("error");
    showFailureAlert(
      error,
      "turn",
      t("mobile.chat.attachment.openFailed"),
      error instanceof Error ? sourceText(error.message) : t("mobile.chat.tryAgain"),
    );
  } finally {
    if (temporary?.exists) temporary.delete();
  }
}
