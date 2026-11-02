import type { NativeStackNavigationProp } from "expo-router/native-stack";
import { type ParamListBase, useNavigation, useNavigationState, useRoute } from "expo-router/react-navigation";
import { useEffect } from "react";
import { useSplitLayout } from "@/shared/components/adaptive-split";

/**
 * Whether the chat is the first screen of the detail column on a wide window, beside the chat list
 * pane. It has no Back there, as the list beside it opens the other chats, and the edge swipe, in the
 * middle of the window, does not close it. A chat that another chat opened keeps both.
 */
export function useSplitDetailRoot(): boolean {
  const split = useSplitLayout() !== null;
  const route = useRoute();
  const navigation = useNavigation<NativeStackNavigationProp<ParamListBase>>();
  const aboveHome = useNavigationState((state) => {
    const index = state.routes.findIndex((candidate) => candidate.key === route.key);
    return index > 0 && state.routes[index - 1]?.name === "connected";
  });
  const detailRoot = split && aboveHome;
  useEffect(() => {
    navigation.setOptions({ gestureEnabled: !detailRoot });
  }, [navigation, detailRoot]);
  return detailRoot;
}
