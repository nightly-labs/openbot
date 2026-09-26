import { Host } from "@expo/ui";
import { Button } from "@expo/ui/swift-ui";
import {
  accessibilityLabel,
  buttonBorderShape,
  buttonStyle,
  controlSize,
  disabled as disabledModifier,
  labelStyle,
} from "@expo/ui/swift-ui/modifiers";
import { isLiquidGlassAvailable } from "expo-glass-effect";

import { useText } from "@/shared/lib/text";
import type { ScannerCloseButtonProps } from "./scanner-close-button";

export function ScannerCloseButton({ disabled, onPress }: ScannerCloseButtonProps) {
  const { t } = useText();
  return (
    <Host ignoreSafeArea="all" style={{ width: 44, height: 44 }}>
      <Button
        label={t("mobile.auth.closeScanner")}
        systemImage="xmark"
        onPress={onPress}
        modifiers={[
          buttonStyle(isLiquidGlassAvailable() ? "glass" : "bordered"),
          buttonBorderShape("circle"),
          controlSize("large"),
          labelStyle("iconOnly"),
          disabledModifier(disabled),
          accessibilityLabel(t("mobile.auth.closeScanner")),
        ]}
      />
    </Host>
  );
}
