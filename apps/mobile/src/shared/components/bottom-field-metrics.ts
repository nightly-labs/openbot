import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useSplitLayout } from "@/shared/components/adaptive-split";
import { GLASS_CAPSULE_HEIGHT } from "@/shared/components/glass-capsule";
import { composerBottomGap, restingComposerHeight } from "@/shared/lib/composer-metrics";
import { useFontScale } from "@/shared/lib/font-scale";
import { isAndroid } from "@/shared/lib/platform";

export function useBottomFieldMetrics(): { height: number; bottomGap: number } {
  const besideComposer = useSplitLayout() !== null;
  const fontScale = useFontScale();
  const insets = useSafeAreaInsets();
  if (besideComposer) return { height: restingComposerHeight(fontScale), bottomGap: composerBottomGap(insets.bottom) };
  return { height: GLASS_CAPSULE_HEIGHT, bottomGap: isAndroid ? insets.bottom + 8 : Math.max(insets.bottom - 8, 12) };
}
