import type { NativeStackNavigationProp } from "expo-router/native-stack";
import { type ParamListBase, useNavigation } from "expo-router/react-navigation";
import { useEffect, useRef, useState } from "react";

/**
 * True while another full screen, such as a subagent or a second chat, covers this screen in the
 * stack. A sheet does not cover it: the screen stays in view under the sheet and gets no disappear
 * event. The screen shows again at the start of its appear transition, also of a back swipe, or
 * when it gets the focus, if a return sends no appear event.
 *
 * The ref changes in the navigation event, before the render that the change starts, so a store
 * callback can read it. The screen renders again when the value changes.
 */
export function useCoveredByScreen() {
  const navigation = useNavigation<NativeStackNavigationProp<ParamListBase>>();
  const covered = useRef(false);
  const [, setCovered] = useState(false);
  useEffect(() => {
    const change = (next: boolean) => {
      covered.current = next;
      setCovered(next);
    };
    const offDisappear = navigation.addListener("transitionEnd", (event) => {
      if (event.data.closing) change(true);
    });
    const offAppear = navigation.addListener("transitionStart", (event) => {
      if (!event.data.closing) change(false);
    });
    const offFocus = navigation.addListener("focus", () => change(false));
    return () => {
      offDisappear();
      offAppear();
      offFocus();
    };
  }, [navigation]);
  return covered;
}
