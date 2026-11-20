import type { NativeStackNavigationProp } from "expo-router/native-stack";
import { type ParamListBase, useNavigation, useNavigationState, useRoute } from "expo-router/react-navigation";
import { useEffect } from "react";
import { useSplitLayout } from "@/shared/components/adaptive-split";

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
