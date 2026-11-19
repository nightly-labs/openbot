import * as Clipboard from "expo-clipboard";
import { useEffect, useRef, useState } from "react";
import { showFailureAlert } from "@/features/analytics/failure-reports";
import { haptics } from "@/shared/lib/haptics";
import { useText } from "@/shared/lib/text";

const COPIED_MS = 1_400;

export function useCopyMessage(text: string) {
  const { t } = useText();
  const [copied, setCopied] = useState(false);
  const reset = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  useEffect(() => () => clearTimeout(reset.current), []);
  async function copy() {
    try {
      await Clipboard.setStringAsync(text);
      setCopied(true);
      clearTimeout(reset.current);
      reset.current = setTimeout(() => setCopied(false), COPIED_MS);
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
