import { useMemo } from "react";
import { haptics } from "@/shared/lib/haptics";
import { replyWordFeedback } from "../model/reply-reveal";

/** Feedback follows local playback, never network chunks or row layout events. */
export function useReplyHaptics(enabled: boolean) {
  return useMemo(
    () => ({
      onWord(word: string, index: number) {
        if (!enabled) return;
        const feedback = replyWordFeedback(word, index);
        if (feedback === "selection") void haptics.selection();
        else void haptics.impact(feedback);
      },
      onComplete() {
        if (enabled) void haptics.notification("success");
      },
    }),
    [enabled],
  );
}
