import { attachmentFileExtension } from "@openbot/contracts/attachment-files";
import type { AttachmentSummary } from "@openbot/contracts/ipc";
import type { MobileTranslate } from "@openbot/i18n/mobile";
import { MOBILE_ATTACHMENT_BYTES, type RemoteFileUpload } from "@openbot/team-client/remote-peer";
import { queryOptions, useQuery, useQueryClient } from "@tanstack/react-query";
import { Directory, File, Paths } from "expo-file-system";
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
import { shareFilesNative } from "../model/share-files-native";
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

/**
 * A file the chat shows as a picture, as desktop does. An SVG is a `file` attachment, so the agent
 * reads its text, but its preview is an image.
 */
export function showsAsImage(attachment: Pick<AttachmentSummary, "kind" | "previewKind">): boolean {
  return attachment.kind === "image" || attachment.previewKind === "image";
}

/** A picture the photo library takes. The library takes raster images only, not an SVG. */
export function savesToPhotos(attachment: Pick<AttachmentSummary, "kind">): boolean {
  return attachment.kind === "image";
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

type DownloadAttachment = ReturnType<typeof useMobileWorkspaceActions>["downloadAttachment"];

/** The download of one host file. One file view and a whole gallery read the same cache entry. */
function attachmentFileQuery(
  serverId: string,
  attachment: AttachmentSummary,
  downloadAttachment: DownloadAttachment,
  tooLarge: string,
) {
  return queryOptions({
    queryKey: queryKeys.chatAttachment(serverId, attachment.id),
    queryFn: async (): Promise<RemoteFileUpload & { localUri?: string; fileUri?: string }> => {
      if (attachment.size > MOBILE_ATTACHMENT_BYTES) throw new Error(tooLarge);
      const kept = keptImageFile(serverId, attachment);
      if (kept) return kept;
      const data = await downloadAttachment(serverId, attachment.id);
      return {
        ...data,
        fileUri: data.mimeType.startsWith("image/") ? keepImageFile(serverId, attachment, data) : undefined,
      };
    },
    retry: false,
    staleTime: Infinity,
    gcTime: 5 * 60 * 1000,
  });
}

/** A copy of a downloaded file with an extension, in a folder the caller deletes. */
async function writeCopy(folder: Directory, name: string, data: RemoteFileUpload & { fileUri?: string }) {
  const file = new File(folder, name);
  file.writeSync(await fileBase64(data), { encoding: "base64" });
  return file;
}

/** The extension the photo library and the share targets read the type from. */
function imageExtension(attachment: AttachmentSummary, mimeType: string) {
  return attachmentFileExtension(attachment.name) ?? mimeType.split("/")[1] ?? "png";
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
    ...attachmentFileQuery(serverId, attachment, downloadAttachment, t("mobile.chat.attachment.tooLargeForMobile")),
    enabled: preview && !local && !pending,
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
      const extension = imageExtension(attachment, result.data.mimeType);
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
 * The actions of a whole gallery: every image to the photo library, or every image to one share
 * sheet. Each image comes from the cache the chat filled, and downloads only when it is not there.
 */
export function useAttachmentFiles(serverId: string, attachments: readonly AttachmentSummary[]) {
  const { downloadAttachment } = useMobileWorkspaceActions();
  const queryClient = useQueryClient();
  const { t, sourceText } = useText();
  const [busy, setBusy] = useState(false);
  const load = (attachment: AttachmentSummary) =>
    queryClient.fetchQuery(
      attachmentFileQuery(serverId, attachment, downloadAttachment, t("mobile.chat.attachment.tooLargeForMobile")),
    );
  const fail = (error: unknown, title: string) => {
    void haptics.notification("error");
    showFailureAlert(
      error,
      "turn",
      title,
      error instanceof Error ? sourceText(error.message) : t("mobile.chat.tryAgain"),
    );
  };

  /** Saves every image that the photo library takes. It reports its own failure and returns whether all of them saved. */
  async function saveAllToPhotos(): Promise<boolean> {
    setBusy(true);
    const folder = new Directory(Paths.cache, `gallery-save-${Date.now()}`);
    try {
      const MediaLibrary = await import("expo-media-library").catch(() => null);
      if (!MediaLibrary) throw new Error(t("mobile.chat.attachment.photosNeedUpdate"));
      if (!(await MediaLibrary.requestPermissionsAsync(true, ["photo"])).granted)
        throw new Error(t("mobile.chat.imageGallery.photosPermission"));
      folder.create({ intermediates: true, idempotent: true });
      // One at a time, in chat order, so the library keeps the order of the message.
      for (const [index, attachment] of attachments.filter(savesToPhotos).entries()) {
        const data = await load(attachment);
        const file = await writeCopy(folder, `${index}.${imageExtension(attachment, data.mimeType)}`, data);
        await MediaLibrary.Asset.create(file.uri);
      }
      return true;
    } catch (error) {
      fail(error, t("mobile.chat.imageGallery.saveFailed"));
      return false;
    } finally {
      if (folder.exists) folder.delete();
      setBusy(false);
    }
  }

  /** Opens one share sheet with every image. */
  async function shareAll() {
    setBusy(true);
    try {
      if (!shareFilesNative) throw new Error(t("mobile.chat.imageGallery.shareNeedsUpdate"));
      const uris: string[] = [];
      const types = new Set<string>();
      for (const attachment of attachments) {
        const data = await load(attachment);
        // The chat media folder holds the file with a safe name, and the next launch clears it.
        const uri = data.fileUri ?? keepImageFile(serverId, attachment, data);
        if (!uri) throw new Error(t("mobile.chat.attachment.imageUnavailable"));
        types.add(data.mimeType);
        uris.push(uri);
      }
      await shareFilesNative.shareAsync(uris, types.size === 1 ? ([...types][0] ?? "image/*") : "image/*");
    } catch (error) {
      fail(error, t("mobile.chat.imageGallery.shareFailed"));
    } finally {
      setBusy(false);
    }
  }

  return { busy, saveAllToPhotos, shareAll: () => void shareAll() };
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
