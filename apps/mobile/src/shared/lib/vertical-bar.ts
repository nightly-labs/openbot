import { useVerticalBarEdgeIOS } from "expo-status-bar";
import { Platform, useWindowDimensions } from "react-native";
import { isIOS } from "@/shared/lib/platform";

/**
 * Whether iOS shows the vertical bar beside the content, as on iPhone Duo. The bar holds the status
 * bar and the native bar buttons of the screen; custom views stay in the top bar. It reports the
 * bar, not the device: an open iPhone Duo in portrait has none.
 */
export function useVerticalBarShown(): boolean {
  const edge = useVerticalBarEdgeIOS();
  return isIOS && edge !== null;
}

/**
 * Whether the window has the shape of iPhone Duo, folded or open. Other iPhones keep the app in a tall
 * portrait window. iPad and Android have their own layouts, so they never match.
 */
export function useDuoWindow(): boolean {
  const { width, height } = useWindowDimensions();
  return Platform.OS === "ios" && !Platform.isPad && Math.min(width, height) / Math.max(width, height) > 0.6;
}
