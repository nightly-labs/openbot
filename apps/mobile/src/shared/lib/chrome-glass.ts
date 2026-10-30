import { useMemo } from "react";
import { StyleSheet, type ViewStyle } from "react-native";
import { useCSSVariable } from "uniwind";

/**
 * The glass of the search field and the bar buttons on Android: the solid glass of the design, an
 * almost opaque fill with a hairline edge and a soft shadow. Android has no Liquid Glass, and its
 * blur does not work over a scroll view (`BlurTargetView` draws a grainy band and stops the row
 * layout animations). Without the blur, the clear glass would show the rows through the field.
 */
export function useChromeGlass(): ViewStyle {
  const [fill, edge] = useCSSVariable(["--openbot-bg-chrome-glass", "--openbot-border-chrome-glass"]);
  return useMemo(
    () => ({
      backgroundColor: String(fill),
      borderColor: String(edge),
      borderWidth: StyleSheet.hairlineWidth,
      boxShadow: "0 6px 18px rgba(0, 0, 0, 0.07)",
    }),
    [fill, edge],
  );
}
