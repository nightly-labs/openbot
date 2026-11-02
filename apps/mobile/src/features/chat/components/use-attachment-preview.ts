import type { AttachmentSummary } from "@openbot/contracts/ipc";
import { MOBILE_ATTACHMENT_BYTES } from "@openbot/team-client/remote-peer";
import { File } from "expo-file-system";
import { router } from "expo-router";
import { useState } from "react";
import { showFailureAlert } from "@/features/analytics/failure-reports";
import { haptics } from "@/shared/lib/haptics";
import { useText } from "@/shared/lib/text";
import { attachmentCodeLanguage, attachmentPreviewKind, PREVIEW_TEXT_LIMIT } from "../model/attachment-file-preview";
import { type CodePreviewEntry, storeCodePreview } from "../model/code-preview-store";
import { useMediaFile } from "./use-media-file";

/**
 * Opens a host file on the preview screen, as the desktop file panel shows it. The file downloads
 * when the user opens it, to the place a player reads from. `kind` is null for a file with no
 * preview, which the caller opens in the share sheet.
 */
export function useAttachmentPreview(serverId: string, attachment: AttachmentSummary) {
  const { t, sourceText } = useText();
  const kind = attachment.size > MOBILE_ATTACHMENT_BYTES ? null : attachmentPreviewKind(attachment);
  const file = useMediaFile(serverId, attachment, false);
  const [opening, setOpening] = useState(false);

  async function open() {
    if (!kind) return;
    setOpening(true);
    try {
      const result = file.data ? { data: file.data, error: null } : await file.refetch();
      if (result.error) throw result.error;
      if (!result.data) throw new Error(t("mobile.chat.attachment.unavailable"));
      const local = { uri: result.data, name: attachment.name, mimeType: attachment.mimeType };
      const entry: CodePreviewEntry = { kind, source: "", file: local };
      if (kind === "html") {
        entry.source = await new File(result.data).text();
        entry.language = "html";
      } else if (kind === "markdown" || kind === "text") {
        const text = await new File(result.data).text();
        entry.source = text.slice(0, PREVIEW_TEXT_LIMIT);
        entry.truncated = text.length > PREVIEW_TEXT_LIMIT;
        entry.language = kind === "markdown" ? "markdown" : attachmentCodeLanguage(attachment.name);
      }
      const previewId = storeCodePreview(entry);
      router.push({ pathname: "/code-preview/[previewId]", params: { previewId } });
    } catch (error) {
      void haptics.notification("error");
      showFailureAlert(
        error,
        "turn",
        t("mobile.chat.attachment.openFailed"),
        error instanceof Error ? sourceText(error.message) : t("mobile.chat.tryAgain"),
      );
    } finally {
      setOpening(false);
    }
  }

  return { kind, opening, open: () => void open() };
}
