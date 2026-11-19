import { useNavigation, useRoute } from "expo-router";
import { StackActions } from "expo-router/react-navigation";
import { useCallback } from "react";

/**
 * Closes this screen and each route above it, such as a sheet that is still opening or closing.
 * `router.back()` closes only the route on top of the stack: that sheet would close in place of this
 * screen. `whenFirst` runs when nothing in this stack is under the screen.
 *
 * No flag stays set, so a close that does not happen does not block the next one. A second call
 * before the stack changes is a no-op: its pop names a top route that is already gone.
 */
export function useCloseScreen(whenFirst: () => void): () => void {
  const navigation = useNavigation();
  const routeKey = useRoute().key;
  return useCallback(() => {
    const stack = navigation.getState();
    if (!stack) return;
    // Preloaded routes come after `index`. The pop sees only the routes up to `index`.
    const active = stack.routes.slice(0, stack.index + 1);
    const index = active.findIndex((candidate) => candidate.key === routeKey);
    if (index < 0) return;
    if (index === 0) {
      whenFirst();
      return;
    }
    const top = active[active.length - 1];
    if (!top) return;
    // With the stack as `target`, the pop starts at the `source` route and removes `count` routes.
    // When `source` is already gone, the pop is a no-op in this stack and does not go to a parent.
    navigation.dispatch({ ...StackActions.pop(active.length - index), source: top.key, target: stack.key });
  }, [navigation, routeKey, whenFirst]);
}
