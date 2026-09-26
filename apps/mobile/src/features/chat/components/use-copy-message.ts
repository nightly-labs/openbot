import * as Clipboard from "expo-clipboard";
import { useState } from "react";
import { Alert } from "react-native";
import { useText } from "@/shared/lib/text";

export function useCopyMessage(text: string) {
  const { t } = useText();
  const [copied, setCopied] = useState(false);
  async function copy() {
    try {
      await Clipboard.setStringAsync(text);
      setCopied(true);
      return true;
    } catch {
      Alert.alert(t("mobile.chat.message.copyFailed"), t("mobile.chat.copyFailedMessage"));
      return false;
    }
  }
  return { copy, copied };
}
