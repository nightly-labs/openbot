import { ATTACHMENT_FILE_EXTENSIONS } from "@openbot/contracts/attachment-files";
import { MOBILE_ATTACHMENT_BYTES } from "@openbot/team-client/remote-peer";
import { requireNativeView, requireOptionalNativeModule } from "expo";
import type { ReactNode } from "react";
import type { NativeSyntheticEvent, ViewProps } from "react-native";
import type { ComposerFile } from "../model/composer-requests";

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
}

/** `modules/composer-paste`. A build without it, such as Expo Go, pastes text only. */
const NativePasteTarget = requireOptionalNativeModule("OpenBotComposerPaste")
  ? requireNativeView<NativeProps>("OpenBotComposerPaste")
  : null;

/**
 * Wraps the composer field, so a paste of photos, videos or other files adds them as attachments.
 * It takes the field's place in the layout.
 */
export function ComposerPasteTarget({
  children,
  onPasteFiles,
}: {
  children: ReactNode;
  onPasteFiles: (pasted: PastedFiles) => void;
}) {
  if (!NativePasteTarget) return children;
  return (
    <NativePasteTarget
      style={{ flex: 1, minWidth: 0 }}
      extensions={ATTACHMENT_FILE_EXTENSIONS}
      maxBytes={MOBILE_ATTACHMENT_BYTES}
      onPasteFiles={({ nativeEvent }) => onPasteFiles(nativeEvent)}
    >
      {children}
    </NativePasteTarget>
  );
}
