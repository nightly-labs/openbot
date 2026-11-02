import { useWindowDimensions } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useSplitLayout } from "@/shared/components/adaptive-split";
import { GLASS_CAPSULE_HEIGHT } from "@/shared/components/glass-capsule";
import { composerBottomGap, restingComposerHeight } from "@/shared/lib/composer-metrics";
import { isAndroid } from "@/shared/lib/platform";

/**
 * The size and place of a search field at the bottom of a screen. On a wide window the field shows
 * beside a chat, so it takes the composer's resting height and bottom gap: two fields of different
 * sizes side by side look wrong. A narrow window keeps the large field of the phone.
 */
export function useBottomFieldMetrics(): { height: number; bottomGap: number } {
  const besideComposer = useSplitLayout() !== null;
  const { fontScale } = useWindowDimensions();
  const insets = useSafeAreaInsets();
  if (besideComposer) return { height: restingComposerHeight(fontScale), bottomGap: composerBottomGap(insets.bottom) };
  // iOS sets the field into the home indicator area. The Android gesture handle is lower in the
  // inset and the field must stay above it.
  return { height: GLASS_CAPSULE_HEIGHT, bottomGap: isAndroid ? insets.bottom + 8 : Math.max(insets.bottom - 8, 12) };
}
