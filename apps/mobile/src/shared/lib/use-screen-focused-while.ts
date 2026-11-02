import { useNavigation } from "expo-router";
import { useCallback, useRef, useSyncExternalStore } from "react";

/**
 * Whether the screen is focused, read only while `enabled`. A still avatar draws the same face on
 * every screen, so navigation does not render each avatar of a long list again. Disabled, it is true.
 * `useIsFocused` would render every avatar on each focus change. Expo Router warns when
 * `navigation.isFocused()` runs during render, so the subscription reads it and the focus events
 * update it. Before the subscription, the screen counts as focused.
 */
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
