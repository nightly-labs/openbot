import { useThemeColor } from "heroui-native/hooks";
import { useMemo } from "react";
import { StyleSheet, type ViewStyle } from "react-native";
import { useCSSVariable } from "uniwind";
import { isAndroid } from "@/shared/lib/platform";

/**
 * The fill of the bar buttons where there is no Liquid Glass. Android has no glass: the buttons are
 * plain, with the fill of the chat composer and its buttons, and no edge or shadow. iOS without Liquid
 * Glass keeps the solid glass of the design: an almost opaque fill with a hairline edge and a soft
 * shadow.
 *
 * A bar button sets `shadow: false`: the native header clips a view to its bounds, so the soft shadow
 * of a 40 dp circle in a 48 dp button showed as a grey square around it.
 */
export function useChromeGlass({ shadow = true }: { shadow?: boolean } = {}): ViewStyle {
  const [fill, edge] = useCSSVariable(["--openbot-bg-chrome-glass", "--openbot-border-chrome-glass"]);
  const plain = useThemeColor("default");
  return useMemo(
    () =>
      isAndroid
        ? { backgroundColor: String(plain) }
        : {
            backgroundColor: String(fill),
            borderColor: String(edge),
            borderWidth: StyleSheet.hairlineWidth,
            boxShadow: shadow ? "0 6px 18px rgba(0, 0, 0, 0.07)" : undefined,
          },
    [fill, edge, plain, shadow],
  );
}
