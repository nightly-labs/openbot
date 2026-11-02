import { router } from "expo-router";
import type { NativeStackNavigationProp } from "expo-router/native-stack";
import { type ParamListBase, useNavigation } from "expo-router/react-navigation";
import { useCallback, useEffect, useRef } from "react";
import { KeyboardController } from "react-native-keyboard-controller";

/**
 * Leaves the chat, once. A swipe back can close the chat while Back is pressed. Two closes put the
 * native stack out of step with JS, so Back does nothing while the chat closes.
 */
export function useLeaveChat(): () => void {
  const navigation = useNavigation<NativeStackNavigationProp<ParamListBase>>();
  const closing = useRef(false);
  useEffect(() => {
    const unsubscribes = [
      navigation.addListener("transitionStart", (event) => {
        if (event.data.closing) closing.current = true;
      }),
      navigation.addListener("transitionEnd", (event) => {
        if (!event.data.closing) closing.current = false;
      }),
      navigation.addListener("gestureCancel", () => {
        closing.current = false;
      }),
    ];
    return () => {
      for (const unsubscribe of unsubscribes) unsubscribe();
    };
  }, [navigation]);
  return useCallback(() => {
    if (closing.current) return;
    closing.current = true;
    void KeyboardController.dismiss();
    if (router.canGoBack()) router.back();
    else router.replace("/connected");
  }, []);
}
