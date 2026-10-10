import * as Clipboard from "expo-clipboard";
import { useState } from "react";
import { showFailureAlert } from "@/features/analytics/failure-reports";
import { haptics } from "@/shared/lib/haptics";
import { useText } from "@/shared/lib/text";

export function useCopyMessage(text: string) {
  const { t } = useText();
  const [copied, setCopied] = useState(false);
  async function copy() {
    try {
      await Clipboard.setStringAsync(text);
      setCopied(true);
      void haptics.notification("success");
      return true;
    } catch (error) {
      void haptics.notification("error");
      showFailureAlert(error, "turn", t("mobile.chat.message.copyFailed"), t("mobile.chat.copyFailedMessage"));
      return false;
    }
  }
  return { copy, copied };
}
