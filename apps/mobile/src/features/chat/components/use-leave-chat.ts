import { useCallback } from "react";
import { KeyboardController } from "react-native-keyboard-controller";
import { backOrConnected } from "@/shared/lib/back-or-connected";
import { useCloseScreen } from "@/shared/lib/use-close-screen";

/**
 * Leaves the chat, a channel or a thread. Back closes the chat route and each route above it, not
 * only the route on top of the stack: after a sheet or the browser closes, Back still closes the
 * chat. A close that does not happen does not block the next press.
 */
export function useLeaveChat(): () => void {
  const closeChat = useCloseScreen(backOrConnected);
  return useCallback(() => {
    void KeyboardController.dismiss();
    closeChat();
  }, [closeChat]);
}
