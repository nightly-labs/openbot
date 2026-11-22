import { useMemo } from "react";
import { useHapticsPreference } from "@/features/settings/model/haptics";
import { haptics } from "@/shared/lib/haptics";
import { replyWordFeedback } from "../model/reply-reveal";

const FLUSH_KNOCKS = [
  { style: "heavy", at: 0 },
  { style: "light", at: 240 },
  { style: "heavy", at: 360 },
] as const;

export function useReplyHaptics(active: boolean) {
  const replies = useHapticsPreference((state) => state.replies);
  const enabled = active && replies;
  return useMemo(
    () => ({
      onWord(word: string, index: number) {
        if (!enabled) return;
        const feedback = replyWordFeedback(word, index);
        if (feedback === "selection") void haptics.selection();
        else void haptics.impact(feedback);
      },
      onFlush() {
        if (!enabled) return;
        for (const { style, at } of FLUSH_KNOCKS) setTimeout(() => void haptics.impact(style), at);
      },
      onComplete() {
        if (enabled) void haptics.notification("success");
      },
    }),
    [enabled],
  );
}
