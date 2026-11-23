import { useVerticalBarEdgeIOS } from "expo-status-bar";
import { Platform, useWindowDimensions } from "react-native";
import { isIOS } from "@/shared/lib/platform";

export function useVerticalBarShown(): boolean {
  const edge = useVerticalBarEdgeIOS();
  return isIOS && edge !== null;
}

export function useDuoWindow(): boolean {
  const { width, height } = useWindowDimensions();
  return Platform.OS === "ios" && !Platform.isPad && Math.min(width, height) / Math.max(width, height) > 0.6;
}
