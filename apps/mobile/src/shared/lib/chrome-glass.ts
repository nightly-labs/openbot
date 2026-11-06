import { useMemo } from "react";
import { StyleSheet, type ViewStyle } from "react-native";
import { useCSSVariable } from "uniwind";

/**
 * The glass of the search field and the bar buttons on Android: the solid glass of the design, an
 * almost opaque fill with a hairline edge and a soft shadow. Android has no Liquid Glass. A surface
 * that blurs (the home search field, `AndroidHeaderBlur`) lays its own fill over a `BlurView`.
 *
 * A bar button sets `shadow: false`: the native header clips a view to its bounds, so the soft shadow
 * of a 40 dp circle in a 48 dp button showed as a grey square around it.
 */
export function useChromeGlass({ shadow = true }: { shadow?: boolean } = {}): ViewStyle {
  const [fill, edge] = useCSSVariable(["--openbot-bg-chrome-glass", "--openbot-border-chrome-glass"]);
  return useMemo(
    () => ({
      backgroundColor: String(fill),
      borderColor: String(edge),
      borderWidth: StyleSheet.hairlineWidth,
      boxShadow: shadow ? "0 6px 18px rgba(0, 0, 0, 0.07)" : undefined,
    }),
    [fill, edge, shadow],
  );
}
