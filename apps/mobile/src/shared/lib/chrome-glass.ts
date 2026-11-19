import { useThemeColor } from "heroui-native/hooks";
import { useMemo } from "react";
import { StyleSheet, type ViewStyle } from "react-native";
import { useCSSVariable } from "uniwind";
import { isAndroid } from "@/shared/lib/platform";

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
