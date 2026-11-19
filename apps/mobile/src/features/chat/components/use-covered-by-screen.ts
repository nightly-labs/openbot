import type { NativeStackNavigationProp } from "expo-router/native-stack";
import { type ParamListBase, useNavigation } from "expo-router/react-navigation";
import { useEffect, useRef, useState } from "react";

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
