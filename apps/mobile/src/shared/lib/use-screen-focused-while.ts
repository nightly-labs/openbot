import { useNavigation } from "expo-router";
import { useCallback, useRef, useSyncExternalStore } from "react";

export function useScreenFocusedWhile(enabled: boolean): boolean {
  const navigation = useNavigation();
  const focused = useRef(true);
  const subscribe = useCallback(
    (notify: () => void) => {
      if (!enabled) return () => undefined;
      const update = (value: boolean) => {
        focused.current = value;
        notify();
      };
      update(navigation.isFocused());
      const removeFocus = navigation.addListener("focus", () => update(true));
      const removeBlur = navigation.addListener("blur", () => update(false));
      return () => {
        removeFocus();
        removeBlur();
      };
    },
    [enabled, navigation],
  );
  return useSyncExternalStore(subscribe, () => !enabled || focused.current);
}
