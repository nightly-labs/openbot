import { useEffect, useRef } from "react";
import { useMobileSession } from "@/features/auth/context/mobile-session-context";
import { useAppForeground } from "@/shared/lib/use-app-foreground";
import { mobileAnalytics } from "./mobile-analytics";
import { useAnalyticsPreference } from "./preference";

export function MobileAnalyticsLifecycle() {
  const { loading, session } = useMobileSession();
  const ready = useAnalyticsPreference((state) => state.ready);
  const foreground = useAppForeground();
  const opened = useRef(false);
  const previous = useRef(false);
  useEffect(() => {
    if (!ready || loading) return;
    if (foreground && !previous.current) {
      mobileAnalytics.track("mobile_app_opened", {
        kind: opened.current ? "foreground" : "cold_start",
        signed_in: Boolean(session),
      });
      opened.current = true;
    }
    previous.current = foreground;
  }, [ready, loading, foreground, session]);
  return null;
}
