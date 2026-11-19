import { router } from "expo-router";
import { useCallback } from "react";
import { KeyboardController } from "react-native-keyboard-controller";

import { useCloseScreen } from "@/shared/lib/use-close-screen";

function leaveFirstChat() {
  if (router.canGoBack()) router.back();
  else router.replace("/connected");
}

export function useLeaveChat(): () => void {
  const closeChat = useCloseScreen(leaveFirstChat);
  return useCallback(() => {
    void KeyboardController.dismiss();
    closeChat();
  }, [closeChat]);
}
