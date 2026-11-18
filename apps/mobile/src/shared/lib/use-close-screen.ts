import { useNavigation, useRoute } from "expo-router";
import { StackActions } from "expo-router/react-navigation";
import { useCallback } from "react";

/**
 * Closes this screen, and only this screen. `router.back()` closes the route on top of the stack: a
 * sheet that is still closing, or one that opens, would close in place of this screen.
 *
 * A second call does nothing: the stack no longer has the route. No flag stays set, so a close that
 * does not happen does not block the next one. `whenFirst` runs when nothing is under the screen.
 */
export function useCloseScreen(whenFirst: () => void): () => void {
  const navigation = useNavigation();
  const route = useRoute();
  const routeKey = route.key;
  return useCallback(() => {
    const stack = navigation.getState();
    if (!stack) return;
    const index = stack.routes.findIndex((candidate) => candidate.key === routeKey);
    if (index < 0) return;
    if (index === 0) {
      whenFirst();
      return;
    }
    // With the stack as `target`, the pop removes the `source` route and keeps the routes above it.
    // A route that is already gone makes the pop a no-op in this stack; it does not go to a parent.
    navigation.dispatch({ ...StackActions.pop(1), source: routeKey, target: stack.key });
  }, [navigation, routeKey, whenFirst]);
}
