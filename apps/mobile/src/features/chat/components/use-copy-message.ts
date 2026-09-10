import * as Clipboard from "expo-clipboard";
import { useState } from "react";
import { Alert } from "react-native";

export function useCopyMessage(text: string) {
  const [copied, setCopied] = useState(false);
  async function copy() {
    try {
      await Clipboard.setStringAsync(text);
      setCopied(true);
      return true;
    } catch {
      Alert.alert("Could not copy message", "Please try again.");
      return false;
    }
  }
  return { copy, copied };
}
