import { attachmentMimeTypeForName } from "@openbot/contracts/attachment-files";
import { createContext, useCallback, useContext, useRef, useState } from "react";
import { showFailureAlert } from "@/features/analytics/failure-reports";
import { useMobileWorkspaceActions } from "@/features/workspace/context/mobile-workspace-context";
import { haptics } from "@/shared/lib/haptics";
import { useText } from "@/shared/lib/text";
import { attachmentPreviewKind } from "../model/attachment-file-preview";
import type { MessageFileTarget } from "../model/message-file-target";
import { attachmentTypeLabel, shareLocalAttachment } from "./attachment-preview";
import { AttachmentPreviewSheet } from "./attachment-preview-sheet";
import { openFilePreview } from "./use-attachment-preview";
import { messageFileCopy } from "./use-media-file";

/**
 * The action that opens the file a chip names, as a click on the desktop chip does. Null when the
 * message cannot name that file, such as a workspace file in a message from no agent.
 */
export type OpenMessageFile = (text: string) => (() => void) | null;

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

/**
 * Opens a file that a message names, from the agent's workspace or the shared folder of one
 * server. The host sends the file at the tap. A text, Markdown, PDF or spreadsheet file opens on
 * the preview screen, an image opens in a sheet, and any other file opens in the share sheet, which
 * saves it to Files or opens it in another app. `sheet` is the image sheet, for the caller to draw.
 */
export function useMessageFileOpener(serverId: string) {
  const { downloadMessageFile } = useMobileWorkspaceActions();
  const { t, format, sourceText } = useText();
  const [image, setImage] = useState<LocalFile | null>(null);
  // A second tap while the file downloads does nothing.
  const opening = useRef(false);

  const open = useCallback(
    async (target: MessageFileTarget, written: MessageFileTarget | null) => {
      if (opening.current) return;
      opening.current = true;
      void haptics.selection();
      try {
        // When nothing is at the path joined to the message's folder, the name opens as written.
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
        const file = { uri: copy.uri, name: data.name, mimeType, size: copy.size };
        const kind = attachmentPreviewKind(file);
        if (mimeType.startsWith("image/")) setImage(file);
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
    [downloadMessageFile, serverId, sourceText, t],
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
