import type { AttachmentSummary } from "@openbot/contracts/ipc";
import { File } from "expo-file-system";
import { router } from "expo-router";
import { useState } from "react";
import { queryKeys } from "@/features/workspace/model/query-keys";
import { useText } from "@/shared/lib/text";
import {
  type AttachmentPreviewKind,
  attachmentCodeLanguage,
  attachmentPreviewKind,
} from "../model/attachment-file-preview";
import { type CodePreviewEntry, storeCodePreview } from "../model/code-preview-store";
import { useAttachmentDownload } from "../model/large-files";
import { showFileFailure } from "./attachment-preview";
import { requestFile, useMediaFile } from "./use-media-file";

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
  const text = useText();
  const { t } = text;
  const kind =
    useAttachmentDownload(serverId, attachment).download === "desktop" ? null : attachmentPreviewKind(attachment);
  const file = useMediaFile(serverId, attachment, false);
  const [opening, setOpening] = useState(false);

  async function open() {
    if (!kind) return;
    setOpening(true);
    try {
      const result = file.data
        ? { data: file.data, error: null }
        : await requestFile(queryKeys.chatMediaFile(serverId, attachment.id), () => file.refetch());
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
