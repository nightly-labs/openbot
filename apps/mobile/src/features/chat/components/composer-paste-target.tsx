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

/** Copies of the pasted files, and the count of files that could not be copied. */
export interface PastedFiles {
  files: ComposerFile[];
  failed: number;
}

interface NativeProps extends ViewProps {
  extensions: readonly string[];
  /** Android stops a copy one byte after this, so a large file is refused without a full copy. */
  maxBytes: number;
  onPasteFiles: (event: NativeSyntheticEvent<PastedFiles>) => void;
  onSubmitKey: (event: NativeSyntheticEvent<{ text: string }>) => void;
}

/**
 * `modules/composer-paste`. A build without it, such as Expo Go, pastes text only, and Return on a
 * hardware keyboard adds a line break.
 */
const nativeModule = requireOptionalNativeModule<{ chatDrop?: boolean }>("OpenBotComposerPaste");
const NativePasteTarget = nativeModule ? requireNativeView<NativeProps>("OpenBotComposerPaste") : null;

interface NativeDropProps extends ViewProps {
  enabled: boolean;
  extensions: readonly string[];
  maxBytes: number;
  onDropFiles: (event: NativeSyntheticEvent<PastedFiles>) => void;
}

/** The `ChatDrop` view of the same module. A build before it, such as an old dev build, has no drop target. */
const NativeDropTarget = nativeModule?.chatDrop
  ? requireNativeView<NativeDropProps>("OpenBotComposerPaste", "ChatDrop")
  : null;

/**
 * Adds pasted or dropped copies as attachments, in the same way as a share from another app, then
 * deletes the copies. With no attachments, it only deletes them.
 */
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

/**
 * Wraps the chat, so a drop of photos, videos or other files from another app, such as the
 * screenshot preview on iPhone, adds them as attachments. While `enabled` is false, the chat refuses
 * the drop. It fills its parent.
 */
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

/**
 * Wraps the composer field, so a paste of photos, videos or other files adds them as attachments.
 * Return on a hardware keyboard, such as on an iPad, sends `onSubmitKey` with the text of the field.
 * Shift+Return adds a line break. It takes the field's place in the layout.
 */
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
