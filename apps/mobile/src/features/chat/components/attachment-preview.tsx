import { attachmentFileExtension } from "@openbot/contracts/attachment-files";
import type { AttachmentSummary } from "@openbot/contracts/ipc";
import type { MobileTranslate } from "@openbot/i18n/mobile";
import { MOBILE_ATTACHMENT_BYTES, type RemoteFileUpload } from "@openbot/team-client/remote-peer";
import { queryOptions, useQuery, useQueryClient } from "@tanstack/react-query";
import * as Clipboard from "expo-clipboard";
import { Directory, File, FileMode, Paths } from "expo-file-system";
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
import {
  fileLimitText,
  largeDownloadOf,
  MOBILE_LARGE_FILE_BYTES,
  requestLargeFile,
  useAttachmentDownload,
} from "../model/large-files";
import { shareTypeOptions } from "../model/share-file-type";
import { shareFilesNative } from "../model/share-files-native";
import { mediaFile, writeMediaFile } from "./use-media-file";

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
 * A downloaded image, or a file above the attachment limit, as a file in the chat media folder. The
 * image view gets a short file URI, not a data URL of many megabytes: Android Glide copies its
 * source text, and a large data URL ran the app out of memory. A large file is not kept as Base64
 * in the cache. A file that cannot be written leaves the data.
 */
async function keepFile(
  serverId: string,
  attachment: AttachmentSummary,
  data: RemoteFileUpload,
): Promise<string | undefined> {
  try {
    const file = mediaFile(serverId, attachment);
    if (!file.exists || file.size !== attachment.size) {
      file.parentDirectory.create({ intermediates: true, idempotent: true });
      await writeMediaFile(file, data.base64);
    }
    return file.uri;
  } catch {
    return undefined;
  }
}

/**
 * A file that this launch downloaded before, as a file that is whole: an image when the phone also
 * knows its shape, or a file above the attachment limit. It is used again without a new download.
 * Its data has no Base64.
 */
function keptFile(serverId: string, attachment: AttachmentSummary): (RemoteFileUpload & { fileUri: string }) | null {
  const large = attachment.size > MOBILE_ATTACHMENT_BYTES;
  if (!large && (!attachment.mimeType.startsWith("image/") || !dimensionCache.get(attachment.id))) return null;
  try {
    const file = mediaFile(serverId, attachment);
    if (!file.exists || file.size !== attachment.size) return null;
    return { name: attachment.name, mimeType: attachment.mimeType, base64: "", fileUri: file.uri };
  } catch {
    return null;
  }
}

/**
 * Writes a downloaded file to `file`. Data with no Base64 copies its kept file, so a large file is
 * not read back into memory.
 */
async function writeFileData(file: File, data: RemoteFileUpload & { fileUri?: string }) {
  if (data.base64 || !data.fileUri) await file.write(data.base64, { encoding: "base64" });
  else await new File(data.fileUri).copy(file);
}

/** A text file up to this size goes on the clipboard as text. */
const COPY_TEXT_BYTES = 1024 * 1024;

/**
 * A file that Copy puts on the clipboard: a raster image as a picture, or a text file as text. The
 * clipboard does not hold other files.
 */
export function copiesToClipboard(attachment: Pick<AttachmentSummary, "kind" | "previewKind" | "size">): boolean {
  // The clipboard takes an image as one Base64 string, so a large image stays out of JS memory, as in the viewer.
  if (savesToPhotos(attachment)) return attachment.size <= MOBILE_ATTACHMENT_BYTES;
  return attachment.previewKind === "text" && attachment.size <= COPY_TEXT_BYTES;
}

/** A name that a folder takes: no path separators or control characters. */
function safeFileName(name: string) {
  return name.replace(/[/\\\p{Cc}]/gu, "_");
}

/** The text of a downloaded text file. */
async function fileText(data: RemoteFileUpload & { fileUri?: string }) {
  if (!data.base64 && data.fileUri) return new File(data.fileUri).text();
  if (!data.base64) throw new Error(currentText().t("mobile.chat.attachment.unavailable"));
  const file = new File(Paths.cache, `${Date.now()}-copy.txt`);
  try {
    await file.write(data.base64, { encoding: "base64" });
    return await file.text();
  } finally {
    if (file.exists) file.delete();
  }
}

/** Writes a downloaded file into a folder the user picked, under a name that is not in use there. */
async function writeToFolder(
  folder: Directory,
  attachment: AttachmentSummary,
  data: RemoteFileUpload & { fileUri?: string },
) {
  const name = safeFileName(attachment.name) || "file";
  const dot = name.lastIndexOf(".");
  const stem = dot > 0 ? name.slice(0, dot) : name;
  const extension = dot > 0 ? name.slice(dot) : "";
  let candidate = name;
  // iOS does not replace a file that is there. Android gives a new name to a file that is there.
  for (let copy = 2; fileExists(folder, candidate); copy += 1) candidate = `${stem} ${copy}${extension}`;
  const kept = data.base64 ? undefined : data.fileUri;
  if (!data.base64 && !kept && attachment.size > 0)
    throw new Error(currentText().t("mobile.chat.attachment.unavailable"));
  if (kept) {
    // A kept file copies natively, so a large file is not read into memory. A folder that cannot take
    // a copy, such as an Android content URI, gets the file in chunks below.
    try {
      await new File(kept).copy(new File(folder, candidate));
      return;
    } catch {}
  }
  const file = folder.createFile(candidate, data.mimeType);
  if (kept) await copyInChunks(new File(kept), file);
  else await file.write(data.base64, { encoding: "base64" });
}

/** The size of one read in `copyInChunks`. */
const COPY_CHUNK_BYTES = 1024 * 1024;

/** Copies a file one chunk at a time, so a large file never is in JS memory at once. */
async function copyInChunks(source: File, target: File) {
  const input = source.open(FileMode.ReadOnly);
  try {
    const output = target.open(FileMode.Truncate);
    try {
      for (;;) {
        const chunk = await input.readBytes(COPY_CHUNK_BYTES);
        if (chunk.length === 0) break;
        await output.writeBytes(chunk);
      }
    } finally {
      output.close();
    }
  } finally {
    input.close();
  }
}

/** Whether a folder has a file with this name. A content URI folder on Android cannot say, and gives a new name itself. */
function fileExists(folder: Directory, name: string) {
  try {
    return new File(folder, name).exists;
  } catch {
    return false;
  }
}

/** The user closed the folder picker without a folder. */
function pickerCancelled(error: unknown) {
  return error instanceof Error && /cancel/i.test(error.message);
}

/** Puts a downloaded image on the clipboard as a picture, as desktop does. */
async function copyImageData(data: RemoteFileUpload & { fileUri?: string }) {
  const base64 = data.base64 || (data.fileUri ? await new File(data.fileUri).base64() : "");
  if (!base64) throw new Error(currentText().t("mobile.chat.attachment.imageUnavailable"));
  await Clipboard.setImageAsync(base64);
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
      // A file between the two limits runs this query only when the user asks for it, or with the
      // setting on: `useAttachmentFile` does not enable it before.
      if (attachment.size > MOBILE_LARGE_FILE_BYTES) throw new Error(tooLarge);
      const kept = keptFile(serverId, attachment);
      if (kept) return kept;
      const data = await downloadAttachment(serverId, attachment.id, largeDownloadOf(attachment));
      const large = attachment.size > MOBILE_ATTACHMENT_BYTES;
      const fileUri =
        large || data.mimeType.startsWith("image/") ? await keepFile(serverId, attachment, data) : undefined;
      // The cache does not keep the Base64 of a large file that is on disk: the file has it.
      return fileUri && large ? { ...data, base64: "", fileUri } : { ...data, fileUri };
    },
    retry: false,
    staleTime: Infinity,
    gcTime: 5 * 60 * 1000,
  });
}

/** A copy of a downloaded file with an extension, in a folder the caller deletes. */
async function writeCopy(folder: Directory, name: string, data: RemoteFileUpload & { fileUri?: string }) {
  const file = new File(folder, name);
  await writeFileData(file, data);
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
  const text = useText();
  const { t, sourceText } = text;
  // A large file shows only after the user asks for it, or with the setting on.
  const { download } = useAttachmentDownload(serverId, attachment);
  const [sharing, setSharing] = useState(false);
  const pending = attachment.id.startsWith("mobile-draft-attachment-");
  const local =
    attachment.previewUrl?.startsWith("data:image/") || (pending && attachment.previewUrl?.startsWith("file://"))
      ? attachment.previewUrl
      : null;
  const query = useQuery({
    ...attachmentFileQuery(
      serverId,
      attachment,
      downloadAttachment,
      t("mobile.chat.attachment.tooLargeForMobile", { limit: fileLimitText(text, MOBILE_LARGE_FILE_BYTES) }),
    ),
    enabled: preview && download === "download" && !local && !pending,
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
    // The user asks for this file, so a large file downloads.
    requestLargeFile(serverId, attachment.id);
    setSharing(true);
    let file: File | null = null;
    try {
      if (!(await Sharing.isAvailableAsync())) throw new Error(t("mobile.chat.attachment.sharingUnavailable"));
      const result = query.data ? { data: query.data, error: null } : await query.refetch();
      if (result.error) throw result.error;
      if (!result.data) throw new Error(t("mobile.chat.attachment.unavailable"));
      const name = safeFileName(attachment.name);
      file = new File(Paths.cache, `${Date.now()}-${name}`);
      await writeFileData(file, result.data);
      await Sharing.shareAsync(file.uri, {
        ...shareTypeOptions(file.uri, result.data.mimeType),
        dialogTitle: attachment.name,
      });
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
    requestLargeFile(serverId, attachment.id);
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
      await writeFileData(file, result.data);
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
  /** Puts the image on the clipboard. It reports its own failure and returns whether it copied. */
  async function copyImage(): Promise<boolean> {
    requestLargeFile(serverId, attachment.id);
    setSharing(true);
    try {
      const result = query.data ? { data: query.data, error: null } : await query.refetch();
      if (result.error) throw result.error;
      if (!result.data) throw new Error(t("mobile.chat.attachment.imageUnavailable"));
      await copyImageData(result.data);
      return true;
    } catch (error) {
      void haptics.notification("error");
      showFailureAlert(
        error,
        "turn",
        t("mobile.chat.attachment.copyImageFailed"),
        error instanceof Error ? sourceText(error.message) : t("mobile.chat.tryAgain"),
      );
      return false;
    } finally {
      setSharing(false);
    }
  }
  return {
    pending,
    localUri,
    uri,
    dimensions,
    saveToPhotos,
    copyImage,
    query,
    sharing,
    busy: sharing || query.isFetching,
    share: () => void share(),
  };
}

/**
 * The actions on the files of a message or a gallery: copy, share and save one file or all of them.
 * Each file comes from the cache the chat filled, and downloads only when it is not there.
 */
export function useAttachmentFiles(serverId: string, attachments: readonly AttachmentSummary[]) {
  const { downloadAttachment } = useMobileWorkspaceActions();
  const queryClient = useQueryClient();
  const text = useText();
  const { t, sourceText } = text;
  const [busy, setBusy] = useState(false);
  const load = (attachment: AttachmentSummary) =>
    queryClient.fetchQuery(
      attachmentFileQuery(
        serverId,
        attachment,
        downloadAttachment,
        t("mobile.chat.attachment.tooLargeForMobile", { limit: fileLimitText(text, MOBILE_LARGE_FILE_BYTES) }),
      ),
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

  /**
   * Saves the images, or every image of the files, that the photo library takes. It reports its own
   * failure and returns whether all of them saved.
   */
  async function saveAllToPhotos(only: readonly AttachmentSummary[] = attachments): Promise<boolean> {
    setBusy(true);
    const folder = new Directory(Paths.cache, `gallery-save-${Date.now()}`);
    try {
      const MediaLibrary = await import("expo-media-library").catch(() => null);
      if (!MediaLibrary) throw new Error(t("mobile.chat.attachment.photosNeedUpdate"));
      if (!(await MediaLibrary.requestPermissionsAsync(true, ["photo"])).granted)
        throw new Error(t("mobile.chat.imageGallery.photosPermission"));
      folder.create({ intermediates: true, idempotent: true });
      // One at a time, in chat order, so the library keeps the order of the message.
      for (const [index, attachment] of only.filter(savesToPhotos).entries()) {
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

  /**
   * Puts one file on the clipboard: an image as a picture, a text file as text. It reports its own
   * failure and returns whether it copied.
   */
  async function copyFile(attachment: AttachmentSummary): Promise<boolean> {
    setBusy(true);
    const image = savesToPhotos(attachment);
    try {
      const data = await load(attachment);
      if (image) await copyImageData(data);
      else await Clipboard.setStringAsync(await fileText(data));
      return true;
    } catch (error) {
      fail(error, image ? t("mobile.chat.attachment.copyImageFailed") : t("mobile.chat.attachment.copyTextFailed"));
      return false;
    } finally {
      setBusy(false);
    }
  }

  /**
   * Saves the files in a folder that the user picks in Files. It reports its own failure and returns
   * whether all of them saved; a closed picker saves nothing and reports nothing.
   */
  async function saveToFiles(only: readonly AttachmentSummary[] = attachments): Promise<boolean> {
    let folder: Directory;
    try {
      folder = await Directory.pickDirectoryAsync();
    } catch (error) {
      if (!pickerCancelled(error)) fail(error, t("mobile.chat.attachment.saveFilesFailed"));
      return false;
    }
    setBusy(true);
    try {
      for (const attachment of only) await writeToFolder(folder, attachment, await load(attachment));
      return true;
    } catch (error) {
      fail(error, t("mobile.chat.attachment.saveFilesFailed"));
      return false;
    } finally {
      setBusy(false);
    }
  }

  /** Opens the share sheet with the one file. Its targets include Save to Files. */
  async function shareFile(attachment: AttachmentSummary) {
    setBusy(true);
    let file: File | null = null;
    try {
      if (!(await Sharing.isAvailableAsync())) throw new Error(t("mobile.chat.attachment.sharingUnavailable"));
      const data = await load(attachment);
      file = new File(Paths.cache, `${Date.now()}-${safeFileName(attachment.name)}`);
      await writeFileData(file, data);
      await Sharing.shareAsync(file.uri, {
        ...shareTypeOptions(file.uri, data.mimeType),
        dialogTitle: attachment.name,
      });
    } catch (error) {
      fail(error, t("mobile.chat.attachment.openFailed"));
    } finally {
      if (file?.exists) file.delete();
      setBusy(false);
    }
  }

  /** Opens one share sheet with every file. */
  async function shareAll() {
    const only = attachments.length === 1 ? attachments[0] : undefined;
    if (only) return shareFile(only);
    setBusy(true);
    // A gallery has images only; a message can have other files, and its text says files.
    const images = attachments.every(showsAsImage);
    try {
      if (!shareFilesNative)
        throw new Error(
          images ? t("mobile.chat.imageGallery.shareNeedsUpdate") : t("mobile.chat.attachment.shareFilesNeedsUpdate"),
        );
      const uris: string[] = [];
      const types = new Set<string>();
      for (const attachment of attachments) {
        const data = await load(attachment);
        // The chat media folder holds the file with a safe name, and the next launch clears it.
        const uri = data.fileUri ?? (await keepFile(serverId, attachment, data));
        if (!uri)
          throw new Error(
            images ? t("mobile.chat.attachment.imageUnavailable") : t("mobile.chat.attachment.unavailable"),
          );
        types.add(data.mimeType);
        uris.push(uri);
      }
      const imageTypes = [...types].every((type) => type.startsWith("image/"));
      await shareFilesNative.shareAsync(
        uris,
        types.size === 1 ? ([...types][0] ?? "*/*") : imageTypes ? "image/*" : "*/*",
      );
    } catch (error) {
      fail(error, images ? t("mobile.chat.imageGallery.shareFailed") : t("mobile.chat.attachment.shareFilesFailed"));
    } finally {
      setBusy(false);
    }
  }

  return {
    busy,
    copyFile,
    saveAllToPhotos,
    saveToFiles,
    shareFile: (attachment: AttachmentSummary) => void shareFile(attachment),
    shareAll: () => void shareAll(),
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
    await Sharing.shareAsync(uri, { ...shareTypeOptions(uri, file.mimeType), dialogTitle: file.name });
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
