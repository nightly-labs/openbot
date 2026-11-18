import { router } from "expo-router";
import { useCallback } from "react";
import { KeyboardController } from "react-native-keyboard-controller";

import { useCloseScreen } from "@/shared/lib/use-close-screen";

const openHome = () => router.replace("/connected");

/**
 * Leaves the chat. Back closes the chat route itself, not the route on top of the stack: after a
 * sheet or the browser closes, Back still closes the chat. A second press during the close does
 * nothing, and a close that does not happen does not block the next press.
 */
export function useLeaveChat(): () => void {
  const closeChat = useCloseScreen(openHome);
  return useCallback(() => {
    void KeyboardController.dismiss();
    closeChat();
  }, [closeChat]);
}
