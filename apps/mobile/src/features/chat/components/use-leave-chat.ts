import { useCallback } from "react";
import { KeyboardController } from "react-native-keyboard-controller";
import { backOrConnected } from "@/shared/lib/back-or-connected";
import { useCloseScreen } from "@/shared/lib/use-close-screen";

export function useLeaveChat(): () => void {
  const closeChat = useCloseScreen(backOrConnected);
  return useCallback(() => {
    void KeyboardController.dismiss();
    closeChat();
  }, [closeChat]);
}
