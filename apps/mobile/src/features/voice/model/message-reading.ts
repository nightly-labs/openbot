import { router } from "expo-router";
import { Alert } from "react-native";
import { create } from "zustand";
import { currentText } from "@/shared/lib/text";
import { type ReplyReading, type ReplyVoiceFailure, readReply, replyVoiceFailureText } from "./reply-voice";
import { speechNative } from "./speech-native";
import { useVoiceSettings } from "./voice-settings";

const useMessageReading = create<{ messageId: string | null }>(() => ({ messageId: null }));

let reading: ReplyReading | null = null;

export const canReadAloud = speechNative !== null;

export function useReadingAloud(messageId: string): boolean {
  return useMessageReading((state) => state.messageId === messageId);
}

function showReadAloudFailure(failure: ReplyVoiceFailure, reason: string | null): void {
  const { t } = currentText();
  const title = t("mobile.chat.message.readAloudFailed");
  if (failure !== "not-ready") {
    Alert.alert(title, replyVoiceFailureText(failure, reason));
    return;
  }
  const message =
    useVoiceSettings.getState().engine === "supertonic"
      ? t("mobile.chat.message.readAloudModelMissing")
      : replyVoiceFailureText(failure, reason);
  Alert.alert(title, message, [
    { text: t("common.cancel"), style: "cancel" },
    { text: t("mobile.chat.composer.voiceSettings"), onPress: () => router.push("/settings/voice") },
  ]);
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
      showReadAloudFailure(failure, reason);
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
