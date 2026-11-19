import { router } from "expo-router";
import { useIsFocused } from "expo-router/react-navigation";
import { useEffect } from "react";
import { AppState } from "react-native";

import {
  loadRatingAsk,
  markRatingAskShown,
  ratingAskDue,
  recordRatingAskUse,
  useRatingAsk,
} from "@/features/rating-ask/model/rating-ask";

const ASK_DELAY_MS = 1500;

let askedThisLaunch = false;

export function useRatingAskGate(ready: boolean): void {
  const isFocused = useIsFocused();
  const loaded = useRatingAsk((state) => state.ready);
  useEffect(() => {
    void loadRatingAsk().catch(() => undefined);
  }, []);
  const shown = ready && isFocused && loaded;
  useEffect(() => {
    if (!shown) return;
    let timer: ReturnType<typeof setTimeout> | null = null;
    const visit = () => {
      recordRatingAskUse();
      if (timer || askedThisLaunch || !ratingAskDue()) return;
      timer = setTimeout(() => {
        if (askedThisLaunch) return;
        askedThisLaunch = true;
        markRatingAskShown();
        router.push("/rate-app");
      }, ASK_DELAY_MS);
    };
    visit();
    const subscription = AppState.addEventListener("change", (state) => {
      if (state === "active") visit();
    });
    return () => {
      subscription.remove();
      if (timer) clearTimeout(timer);
    };
  }, [shown]);
}
