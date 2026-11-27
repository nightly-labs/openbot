import { router } from "expo-router";
import { useEffect, useRef } from "react";
import { useAppForeground } from "@/shared/lib/use-app-foreground";
import { consumeChatBubblePendingRoute } from "./model/chat-bubble-pending-route";

export function useChatBubblePendingRoute(): void {
  const foreground = useAppForeground();
  const previous = useRef(false);

  useEffect(() => {
    const rising = foreground && !previous.current;
    previous.current = foreground;
    if (!rising) return;
    const route = consumeChatBubblePendingRoute();
    if (!route) return;
    router[route.method](...route.args);
  }, [foreground]);
}
