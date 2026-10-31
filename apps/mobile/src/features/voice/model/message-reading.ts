import { Alert } from "react-native";
import { create } from "zustand";
import { currentText } from "@/shared/lib/text";
import { REPLY_VOICE_FAILURE_TEXT, type ReplyReading, readReply } from "./reply-voice";
import { speechNative } from "./speech-native";

/** The message that Read aloud reads now. One message reads at a time. */
const useMessageReading = create<{ messageId: string | null }>(() => ({ messageId: null }));

let reading: ReplyReading | null = null;

/** The build can read aloud: it has the speech module. The voice can still need a download. */
export const canReadAloud = speechNative !== null;

/** True while Read aloud reads the message with `messageId`. */
export function useReadingAloud(messageId: string): boolean {
  return useMessageReading((state) => state.messageId === messageId);
}

/**
 * Reads a message aloud with the reply voice from the settings, or stops it when it reads now.
 * Another message, a voice conversation or a voice sample stops the message that reads.
 */
export function toggleReadAloud(messageId: string, markdown: string): void {
  const same = useMessageReading.getState().messageId === messageId;
  stopReadAloud();
  if (same) return;
  const finish = () => {
    if (reading !== own) return;
    reading = null;
    useMessageReading.setState({ messageId: null });
  };
  const own = readReply(markdown, {
    onPart: () => undefined,
    onDone: finish,
    onReplaced: finish,
    onError: (failure) => {
      finish();
      const { t } = currentText();
      Alert.alert(t("mobile.chat.message.readAloudFailed"), t(REPLY_VOICE_FAILURE_TEXT[failure]));
    },
  });
  reading = own;
  useMessageReading.setState({ messageId });
}

/** Stops Read aloud, such as when the chat closes. */
export function stopReadAloud(): void {
  reading?.stop();
  reading = null;
  useMessageReading.setState({ messageId: null });
}
