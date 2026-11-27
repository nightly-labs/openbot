import { attachmentMimeTypeForName } from "@openbot/contracts/attachment-files";
import type { AttachmentSummary } from "@openbot/contracts/ipc";
import { createContext, useCallback, useContext, useRef, useState } from "react";
import { useRemoteChatContent } from "@/features/servers/model/use-remote-chat-content";
import { useMobileWorkspaceActions } from "@/features/workspace/context/mobile-workspace-context";
import { haptics } from "@/shared/lib/haptics";
import { useText } from "@/shared/lib/text";
import { attachmentPreviewKind } from "../model/attachment-file-preview";
import { largeDownloadOf } from "../model/large-files";
import type { MessageFileTarget } from "../model/message-file-target";
import { attachmentTypeLabel, shareLocalAttachment, showFileFailure } from "./attachment-preview";
import { AttachmentPreviewSheet } from "./attachment-preview-sheet";
import { openFilePreview } from "./use-attachment-preview";
import { mediaFile, messageFileCopy, writeMediaFile } from "./use-media-file";

export interface OpenMessageFile {
  code: (text: string) => (() => void) | null;
  link: (href: string) => (() => void) | null;
}

export const ChatFileActionsContext = createContext<OpenMessageFile | undefined>(undefined);

export function useOpenMessageFile(): OpenMessageFile | undefined {
  return useContext(ChatFileActionsContext);
}

interface LocalFile {
  uri: string;
  name: string;
  mimeType: string;
  size: number;
}

type WorkspaceActions = ReturnType<typeof useMobileWorkspaceActions>;

async function localMessageFile(
  serverId: string,
  target: MessageFileTarget,
  written: MessageFileTarget | null,
  downloadMessageFile: WorkspaceActions["downloadMessageFile"],
): Promise<LocalFile> {
  const [source, data] = await downloadMessageFile(serverId, target).then(
    (found) => [target, found] as const,
    async (error: unknown) => {
      if (!written) throw error;
      return [written, await downloadMessageFile(serverId, written)] as const;
    },
  );
  const mimeType = attachmentMimeTypeForName(data.name);
  const copy = messageFileCopy(serverId, JSON.stringify(source), data.name);
  copy.parentDirectory.create({ intermediates: true, idempotent: true });
  copy.writeSync(data.base64, { encoding: "base64" });
  return { uri: copy.uri, name: data.name, mimeType, size: copy.size };
}

async function localAttachment(
  serverId: string,
  attachment: AttachmentSummary,
  downloadAttachment: WorkspaceActions["downloadAttachment"],
): Promise<LocalFile> {
  const copy = mediaFile(serverId, attachment);
  if (!copy.exists || copy.size !== attachment.size) {
    copy.parentDirectory.create({ intermediates: true, idempotent: true });
    const data = await downloadAttachment(
      serverId,
      attachment.id,
      largeDownloadOf(attachment, copy.uri),
      undefined,
      true,
    );
    if (!data.file) await writeMediaFile(copy, data.base64);
  }
  const mimeType = attachment.mimeType || attachmentMimeTypeForName(attachment.name);
  return { uri: copy.uri, name: attachment.name, mimeType, size: attachment.size };
}

export function useMessageFileOpener(serverId: string) {
  const { downloadMessageFile, downloadAttachment } = useMobileWorkspaceActions();
  const remoteContent = useRemoteChatContent(serverId);
  const { t, format, sourceText } = useText();
  const [image, setImage] = useState<LocalFile | null>(null);
  const opening = useRef(false);

  const open = useCallback(
    async (target: MessageFileTarget, written: MessageFileTarget | null, attachment?: AttachmentSummary) => {
      if (opening.current) return;
      opening.current = true;
      void haptics.selection();
      try {
        const file = attachment
          ? await localAttachment(serverId, attachment, downloadAttachment)
          : await localMessageFile(serverId, target, written, downloadMessageFile);
        const kind = attachmentPreviewKind(file);
        if (file.mimeType.startsWith("image/")) setImage(file);
        else if (kind) await openFilePreview(kind, file, remoteContent);
        else await shareLocalAttachment(file);
      } catch (error) {
        showFileFailure(error, t("mobile.chat.markdown.openFileFailed"), { t, sourceText });
      } finally {
        opening.current = false;
      }
    },
    [downloadMessageFile, downloadAttachment, serverId, sourceText, t, remoteContent],
  );

  const sheet = (
    <AttachmentPreviewSheet
      preview={
        image
          ? {
              name: image.name,
              uri: image.uri,
              type: attachmentTypeLabel(image.name, image.mimeType, t),
              size: format.fileSize(image.size),
            }
          : null
      }
      actions={
        image ? [{ label: t("mobile.chat.preview.share"), onPress: () => void shareLocalAttachment(image) }] : []
      }
      onClose={() => setImage(null)}
    />
  );

  return { open, sheet };
}
