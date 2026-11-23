import { Alert } from "react-native";
import { create } from "zustand";
import { currentText } from "@/shared/lib/text";
import { type ReplyReading, readReply, replyVoiceFailureText } from "./reply-voice";
import { speechNative } from "./speech-native";

const useMessageReading = create<{ messageId: string | null }>(() => ({ messageId: null }));

let reading: ReplyReading | null = null;

export const canReadAloud = speechNative !== null;

export function useReadingAloud(messageId: string): boolean {
  return useMessageReading((state) => state.messageId === messageId);
}

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
    onError: (failure, reason) => {
      finish();
      Alert.alert(currentText().t("mobile.chat.message.readAloudFailed"), replyVoiceFailureText(failure, reason));
    },
  });
  reading = own;
  useMessageReading.setState({ messageId });
}

export function stopReadAloud(): void {
  reading?.stop();
  reading = null;
  useMessageReading.setState({ messageId: null });
}
