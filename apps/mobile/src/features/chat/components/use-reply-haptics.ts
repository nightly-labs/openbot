import { useMemo } from "react";
import { useHapticsPreference } from "@/features/settings/model/haptics";
import { haptics } from "@/shared/lib/haptics";
import { replyWordFeedback } from "../model/reply-reveal";

/** A strong knock, a pause, a light knock, then a strong knock, for the rest of a reply that shows at once. */
const FLUSH_KNOCKS = [
  { style: "heavy", at: 0 },
  { style: "light", at: 240 },
  { style: "heavy", at: 360 },
] as const;

/** Feedback follows local playback, never network chunks or row layout events. */
export function useReplyHaptics(active: boolean) {
  // Settings > Haptics can turn off reply feedback and keep the other haptics.
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
