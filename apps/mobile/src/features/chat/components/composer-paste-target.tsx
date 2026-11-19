import { ATTACHMENT_FILE_EXTENSIONS } from "@openbot/contracts/attachment-files";
import { MOBILE_ATTACHMENT_BYTES } from "@openbot/team-client/remote-peer";
import { requireNativeView, requireOptionalNativeModule } from "expo";
import type { ReactNode } from "react";
import type { NativeSyntheticEvent, ViewProps } from "react-native";
import { showFailureAlert } from "@/features/analytics/failure-reports";
import { haptics } from "@/shared/lib/haptics";
import { currentText } from "@/shared/lib/text";
import { type ComposerFile, deleteComposerFiles } from "../model/composer-requests";
import type { ChatAttachments } from "./use-chat-attachments";

export interface PastedFiles {
  files: ComposerFile[];
  failed: number;
}

interface NativeProps extends ViewProps {
  extensions: readonly string[];
  maxBytes: number;
  onPasteFiles: (event: NativeSyntheticEvent<PastedFiles>) => void;
  onSubmitKey: (event: NativeSyntheticEvent<{ text: string }>) => void;
}

const nativeModule = requireOptionalNativeModule<{ chatDrop?: boolean }>("OpenBotComposerPaste");
const NativePasteTarget = nativeModule ? requireNativeView<NativeProps>("OpenBotComposerPaste") : null;

interface NativeDropProps extends ViewProps {
  enabled: boolean;
  extensions: readonly string[];
  maxBytes: number;
  onDropFiles: (event: NativeSyntheticEvent<PastedFiles>) => void;
}

const NativeDropTarget = nativeModule?.chatDrop
  ? requireNativeView<NativeDropProps>("OpenBotComposerPaste", "ChatDrop")
  : null;

export function addPastedFiles(attachments: ChatAttachments | undefined, { files, failed }: PastedFiles): void {
  if (!attachments) {
    deleteComposerFiles(files);
    return;
  }
  void attachments
    .addShared("", files, () => {})
    .finally(() => {
      deleteComposerFiles(files);
      if (failed === 0) return;
      void haptics.notification("error");
      const { t } = currentText();
      showFailureAlert(
        undefined,
        "turn",
        t("mobile.chat.attachment.addFailed"),
        t("mobile.chat.attachment.unavailable"),
      );
    });
}

export function ChatDropTarget({
  children,
  enabled,
  onDropFiles,
}: {
  children: ReactNode;
  enabled: boolean;
  onDropFiles: (dropped: PastedFiles) => void;
}) {
  if (!NativeDropTarget) return children;
  return (
    <NativeDropTarget
      style={{ flex: 1 }}
      enabled={enabled}
      extensions={ATTACHMENT_FILE_EXTENSIONS}
      maxBytes={MOBILE_ATTACHMENT_BYTES}
      onDropFiles={({ nativeEvent }) => onDropFiles(nativeEvent)}
    >
      {children}
    </NativeDropTarget>
  );
}

export function ComposerPasteTarget({
  children,
  onPasteFiles,
  onSubmitKey,
}: {
  children: ReactNode;
  onPasteFiles: (pasted: PastedFiles) => void;
  onSubmitKey: (text: string) => void;
}) {
  if (!NativePasteTarget) return children;
  return (
    <NativePasteTarget
      style={{ flex: 1, minWidth: 0 }}
      extensions={ATTACHMENT_FILE_EXTENSIONS}
      maxBytes={MOBILE_ATTACHMENT_BYTES}
      onPasteFiles={({ nativeEvent }) => onPasteFiles(nativeEvent)}
      onSubmitKey={({ nativeEvent }) => onSubmitKey(nativeEvent.text)}
    >
      {children}
    </NativePasteTarget>
  );
}
