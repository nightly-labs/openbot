import { attachmentMimeTypeForName } from "@openbot/contracts/attachment-files";
import type { AttachmentSummary } from "@openbot/contracts/ipc";
import { createContext, useCallback, useContext, useRef, useState } from "react";
import { showFailureAlert } from "@/features/analytics/failure-reports";
import { useMobileWorkspaceActions } from "@/features/workspace/context/mobile-workspace-context";
import { haptics } from "@/shared/lib/haptics";
import { useText } from "@/shared/lib/text";
import { attachmentPreviewKind } from "../model/attachment-file-preview";
import { largeDownloadOf } from "../model/large-files";
import type { MessageFileTarget } from "../model/message-file-target";
import { attachmentTypeLabel, shareLocalAttachment } from "./attachment-preview";
import { AttachmentPreviewSheet } from "./attachment-preview-sheet";
import { openFilePreview } from "./use-attachment-preview";
import { mediaFile, messageFileCopy, writeMediaFile } from "./use-media-file";

/**
 * The actions that open the file a chip names, as a click on the desktop chip does: `code` for the
 * text of a code span, `link` for the target of a Markdown link to a path. Null when the message
 * cannot name that file, such as a workspace file in a message from no agent.
 */
export interface OpenMessageFile {
  code: (text: string) => (() => void) | null;
  link: (href: string) => (() => void) | null;
}

export const ChatFileActionsContext = createContext<OpenMessageFile | undefined>(undefined);

/** The file opener of the message around this component. Undefined outside a chat message. */
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

/** A file that a message names, on this phone. When nothing is at the path joined to the message's folder, the name opens as written. */
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
  // The host sends every workspace file as `application/octet-stream`.
  const mimeType = attachmentMimeTypeForName(data.name);
  const copy = messageFileCopy(serverId, JSON.stringify(source), data.name);
  copy.parentDirectory.create({ intermediates: true, idempotent: true });
  copy.writeSync(data.base64, { encoding: "base64" });
  return { uri: copy.uri, name: data.name, mimeType, size: copy.size };
}

/** An attachment on this phone. The copy that its card or an earlier tap downloaded is used again when it is whole. */
async function localAttachment(
  serverId: string,
  attachment: AttachmentSummary,
  downloadAttachment: WorkspaceActions["downloadAttachment"],
): Promise<LocalFile> {
  const copy = mediaFile(serverId, attachment);
  if (!copy.exists || copy.size !== attachment.size) {
    const data = await downloadAttachment(serverId, attachment.id, largeDownloadOf(attachment));
    copy.parentDirectory.create({ intermediates: true, idempotent: true });
    await writeMediaFile(copy, data.base64);
  }
  const mimeType = attachment.mimeType || attachmentMimeTypeForName(attachment.name);
  return { uri: copy.uri, name: attachment.name, mimeType, size: attachment.size };
}

/**
 * Opens a file that a message names, from the agent's workspace or the shared folder of one
 * server. The host sends the file at the tap. A text, Markdown, PDF or spreadsheet file opens on
 * the preview screen, an image opens in a sheet, and any other file opens in the share sheet, which
 * saves it to Files or opens it in another app. `sheet` is the image sheet, for the caller to draw.
 *
 * With `attachment`, a file of the message with the name of the chip, the chip opens that attachment,
 * as a desktop chip does. Its card does not show, and a member who cannot read the path in the
 * workspace can read the attachment.
 */
export function useMessageFileOpener(serverId: string) {
  const { downloadMessageFile, downloadAttachment } = useMobileWorkspaceActions();
  const { t, format, sourceText } = useText();
  const [image, setImage] = useState<LocalFile | null>(null);
  // A second tap while the file downloads does nothing.
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
        else if (kind) await openFilePreview(kind, file);
        else await shareLocalAttachment(file);
      } catch (error) {
        void haptics.notification("error");
        showFailureAlert(
          error,
          "turn",
          t("mobile.chat.markdown.openFileFailed"),
          error instanceof Error ? sourceText(error.message) : t("mobile.chat.tryAgain"),
        );
      } finally {
        opening.current = false;
      }
    },
    [downloadMessageFile, downloadAttachment, serverId, sourceText, t],
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
