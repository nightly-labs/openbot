import type { AttachmentSummary } from "@openbot/contracts/ipc";
import { File } from "expo-file-system";
import { router } from "expo-router";
import { useState } from "react";
import { useText } from "@/shared/lib/text";
import {
  type AttachmentPreviewKind,
  attachmentCodeLanguage,
  attachmentPreviewKind,
} from "../model/attachment-file-preview";
import { type CodePreviewEntry, storeCodePreview } from "../model/code-preview-store";
import { useAttachmentDownload } from "../model/large-files";
import { showFileFailure } from "./attachment-preview";
import { useMediaFile } from "./use-media-file";

/** Opens a file on this phone on the preview screen. The text of a text file is read first. */
export async function openFilePreview(
  kind: AttachmentPreviewKind,
  file: { uri: string; name: string; mimeType: string },
) {
  const entry: CodePreviewEntry = { kind, source: "", file };
  if (kind === "html") {
    entry.source = await new File(file.uri).text();
    entry.language = "html";
  } else if (kind === "markdown" || kind === "text") {
    // The whole file: the screen shows a long file in parts.
    entry.source = await new File(file.uri).text();
    entry.language = kind === "markdown" ? "markdown" : attachmentCodeLanguage(file.name);
  }
  const previewId = storeCodePreview(entry);
  router.push({ pathname: "/code-preview/[previewId]", params: { previewId } });
}

/**
 * Opens a host file on the preview screen, as the desktop file panel shows it. The file downloads
 * when the user opens it, to the place a player reads from. `kind` is null for a file with no
 * preview, which the caller opens in the share sheet.
 */
export function useAttachmentPreview(serverId: string, attachment: AttachmentSummary) {
  const text = useText();
  const { t } = text;
  // A file above the host's limit has no preview. A large file within it previews after a tap.
  const kind =
    useAttachmentDownload(serverId, attachment).download === "desktop" ? null : attachmentPreviewKind(attachment);
  const file = useMediaFile(serverId, attachment, false);
  const [opening, setOpening] = useState(false);

  async function open() {
    if (!kind) return;
    setOpening(true);
    try {
      const result = file.data ? { data: file.data, error: null } : await file.refetch();
      if (result.error) throw result.error;
      if (!result.data) throw new Error(t("mobile.chat.attachment.unavailable"));
      await openFilePreview(kind, { uri: result.data, name: attachment.name, mimeType: attachment.mimeType });
    } catch (error) {
      showFileFailure(error, t("mobile.chat.attachment.openFailed"), text);
    } finally {
      setOpening(false);
    }
  }

  return { kind, opening, open: () => void open() };
}
