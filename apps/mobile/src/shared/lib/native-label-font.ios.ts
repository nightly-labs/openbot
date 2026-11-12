import { font } from "@expo/ui/swift-ui/modifiers";
import { useMemo } from "react";
import { useTextScale } from "@/features/settings/model/text-size-store";
import { APP_FONT } from "@/shared/lib/app-font";

/** The size of the SwiftUI body text style at the default Dynamic Type size. */
const BODY_SIZE = 17;

/**
 * Puts the app font on the label of an `@expo/ui` control at the body size, with Dynamic Type and
 * the text size of Settings › Appearance.
 */
export function useNativeLabelFont() {
  const scale = useTextScale();
  return useMemo(() => [font({ family: APP_FONT, textStyle: "body", size: BODY_SIZE * scale })], [scale]);
}
