import { router, usePreventZoomTransitionDismissal } from "expo-router";
import type { NativeStackNavigationProp } from "expo-router/native-stack";
import { type ParamListBase, useNavigation } from "expo-router/react-navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import { KeyboardController } from "react-native-keyboard-controller";

/** The swipe back of a zoomed chat starts only at the left edge. */
const EDGE_DISMISSAL = { minX: 0, maxX: 24 };
/** No touch is right of -1, so no swipe can start. */
const NO_DISMISSAL = { maxX: -1 };

/**
 * Leaves the chat, once. The back button sits in the edge that the iOS swipe back starts from, so
 * one swipe can press it too, and a swipe can catch the zoom back that the button started. Two
 * closes put the native stack out of step with JS, and iOS then starts the zoom back from a removed
 * view and stops the app. So Back does nothing while the chat closes, and it turns off the swipe
 * before the chat closes.
 */
export function useLeaveChat(): () => void {
  const navigation = useNavigation<NativeStackNavigationProp<ParamListBase>>();
  const closing = useRef(false);
  const [leaving, setLeaving] = useState(false);
  usePreventZoomTransitionDismissal({ unstable_dismissalBoundsRect: leaving ? NO_DISMISSAL : EDGE_DISMISSAL });
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
  useEffect(() => {
    if (!leaving) return;
    // iOS applies the new swipe bounds after the commit that sets them. The frame after it pops the
    // chat, so the zoom back starts with the swipe off.
    const frame = requestAnimationFrame(() => {
      if (router.canGoBack()) router.back();
      else router.replace("/connected");
    });
    return () => cancelAnimationFrame(frame);
  }, [leaving]);
  return useCallback(() => {
    if (closing.current) return;
    closing.current = true;
    void KeyboardController.dismiss();
    setLeaving(true);
  }, []);
}
