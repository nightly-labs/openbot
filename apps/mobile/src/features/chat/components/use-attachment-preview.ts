import type { AttachmentSummary } from "@openbot/contracts/ipc";
import { File } from "expo-file-system";
import { router } from "expo-router";
import { useState } from "react";
import { showFailureAlert } from "@/features/analytics/failure-reports";
import { haptics } from "@/shared/lib/haptics";
import { useText } from "@/shared/lib/text";
import {
  type AttachmentPreviewKind,
  attachmentCodeLanguage,
  attachmentPreviewKind,
} from "../model/attachment-file-preview";
import { type CodePreviewEntry, storeCodePreview } from "../model/code-preview-store";
import { useAttachmentDownload } from "../model/large-files";
import { useMediaFile } from "./use-media-file";

export async function openFilePreview(
  kind: AttachmentPreviewKind,
  file: { uri: string; name: string; mimeType: string },
) {
  const entry: CodePreviewEntry = { kind, source: "", file };
  if (kind === "html") {
    entry.source = await new File(file.uri).text();
    entry.language = "html";
  } else if (kind === "markdown" || kind === "text") {
    entry.source = await new File(file.uri).text();
    entry.language = kind === "markdown" ? "markdown" : attachmentCodeLanguage(file.name);
  }
  const previewId = storeCodePreview(entry);
  router.push({ pathname: "/code-preview/[previewId]", params: { previewId } });
}

export function useAttachmentPreview(serverId: string, attachment: AttachmentSummary) {
  const { t, sourceText } = useText();
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
