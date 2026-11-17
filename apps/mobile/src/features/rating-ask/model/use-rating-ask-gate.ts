import { router } from "expo-router";
import { useIsFocused } from "expo-router/react-navigation";
import { useEffect } from "react";

import {
  loadRatingAsk,
  markRatingAskShown,
  ratingAskDue,
  recordRatingAskUse,
  useRatingAsk,
} from "@/features/rating-ask/model/rating-ask";

// Home settles before the ask covers it, so the ask does not look like part of the loading.
const ASK_DELAY_MS = 1500;

// The ask shows at most once per launch, also when home shows as a screen and as a pane.
let askedThisLaunch = false;

/**
 * Counts the days on which home shows, and opens the rating ask when it is due. `ready` is a home
 * that shows its list with nothing over it: no loader, no first-run flow and no update header.
 */
export function useRatingAskGate(ready: boolean): void {
  const isFocused = useIsFocused();
  const loaded = useRatingAsk((state) => state.ready);
  useEffect(() => {
    void loadRatingAsk().catch(() => undefined);
  }, []);
  const shown = ready && isFocused && loaded;
  useEffect(() => {
    if (!shown) return;
    recordRatingAskUse();
    if (askedThisLaunch || !ratingAskDue()) return;
    const timer = setTimeout(() => {
      if (askedThisLaunch) return;
      askedThisLaunch = true;
      markRatingAskShown();
      router.push("/rate-app");
    }, ASK_DELAY_MS);
    return () => clearTimeout(timer);
  }, [shown]);
}
