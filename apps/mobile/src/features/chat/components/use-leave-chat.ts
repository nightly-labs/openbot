import { router } from "expo-router";
import { useCallback, useRef } from "react";
import { KeyboardController } from "react-native-keyboard-controller";

/**
 * Leaves the chat, once. A second press during the close would pop the screen under the chat. A
 * swipe back does not block Back: a swipe that starts and does not finish leaves the chat open.
 */
export function useLeaveChat(): () => void {
  const leaving = useRef(false);
  return useCallback(() => {
    if (leaving.current) return;
    leaving.current = true;
    void KeyboardController.dismiss();
    if (router.canGoBack()) router.back();
    else router.replace("/connected");
  }, []);
}
