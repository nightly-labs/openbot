import type { NativeStackNavigationProp } from "expo-router/native-stack";
import { type ParamListBase, useNavigation } from "expo-router/react-navigation";
import { useEffect, useState } from "react";

/**
 * True while another full screen, such as a subagent or a second chat, covers this screen in the
 * stack. A sheet does not cover it: the screen stays in view under the sheet and gets no disappear
 * event. The screen shows again at the start of its appear transition, also of a back swipe.
 */
export function useCoveredByScreen(): boolean {
  const navigation = useNavigation<NativeStackNavigationProp<ParamListBase>>();
  const [covered, setCovered] = useState(false);
  useEffect(() => {
    const offDisappear = navigation.addListener("transitionEnd", (event) => {
      if (event.data.closing) setCovered(true);
    });
    const offAppear = navigation.addListener("transitionStart", (event) => {
      if (!event.data.closing) setCovered(false);
    });
    return () => {
      offDisappear();
      offAppear();
    };
  }, [navigation]);
  return covered;
}
