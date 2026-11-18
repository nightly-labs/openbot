import { router } from "expo-router";
import { useCallback } from "react";
import { KeyboardController } from "react-native-keyboard-controller";

import { useCloseScreen } from "@/shared/lib/use-close-screen";

/** A chat opened from a notification or a link can be first in its stack: a parent stack or home is under it. */
function leaveFirstChat() {
  if (router.canGoBack()) router.back();
  else router.replace("/connected");
}

/**
 * Leaves the chat, a channel or a thread. Back closes the chat route and each route above it, not
 * only the route on top of the stack: after a sheet or the browser closes, Back still closes the
 * chat. A close that does not happen does not block the next press.
 */
export function useLeaveChat(): () => void {
  const closeChat = useCloseScreen(leaveFirstChat);
  return useCallback(() => {
    void KeyboardController.dismiss();
    closeChat();
  }, [closeChat]);
}
