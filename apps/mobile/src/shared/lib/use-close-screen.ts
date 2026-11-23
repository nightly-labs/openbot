import { useNavigation, useRoute } from "expo-router";
import { StackActions } from "expo-router/react-navigation";
import { useCallback } from "react";

export function useCloseScreen(whenFirst: () => void): () => void {
  const navigation = useNavigation();
  const routeKey = useRoute().key;
  return useCallback(() => {
    const stack = navigation.getState();
    if (!stack) return;
    const active = stack.routes.slice(0, stack.index + 1);
    const index = active.findIndex((candidate) => candidate.key === routeKey);
    if (index < 0) return;
    if (index === 0) {
      whenFirst();
      return;
    }
    const top = active[active.length - 1];
    if (!top) return;
    navigation.dispatch({ ...StackActions.pop(active.length - index), source: top.key, target: stack.key });
  }, [navigation, routeKey, whenFirst]);
}
