import { Platform } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useVerticalBarShown } from "@/shared/lib/vertical-bar";

export const NATIVE_BAR_HEIGHT = Platform.OS === "ios" ? (Platform.isPad ? 50 : 44) : 64;

export const BAR_BUTTON_SIZE = 48;

export const NATIVE_BAR_BUTTON_TOP = (NATIVE_BAR_HEIGHT - BAR_BUTTON_SIZE) / 2;

const VERTICAL_BAR_TOP_GAP = 20;

export function useBarTop(): number {
  const insets = useSafeAreaInsets();
  const verticalBar = useVerticalBarShown();
  return verticalBar ? Math.max(insets.top, VERTICAL_BAR_TOP_GAP) : insets.top;
}
