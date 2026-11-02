import { Host } from "@expo/ui";
import { Button } from "@expo/ui/swift-ui";
import {
  accessibilityLabel,
  buttonBorderShape,
  buttonStyle,
  controlSize,
  disabled as disabledModifier,
  foregroundStyle,
  labelStyle,
} from "@expo/ui/swift-ui/modifiers";
import { isLiquidGlassAvailable } from "expo-glass-effect";

import { haptics } from "@/shared/lib/haptics";
import type { StageBackButtonProps } from "./stage-back-button";

/** The back or close button on the stage: a native Liquid Glass button, bordered before iOS 26. */
export function StageBackButton({ icon, label, color, disabled = false, onPress }: StageBackButtonProps) {
  return (
    <Host ignoreSafeArea="all" style={{ width: 44, height: 44 }}>
      <Button
        label={label}
        systemImage={icon === "close" ? "xmark" : "chevron.backward"}
        onPress={() => {
          void haptics.impact("soft");
          onPress();
        }}
        modifiers={[
          buttonStyle(isLiquidGlassAvailable() ? "glass" : "bordered"),
          buttonBorderShape("circle"),
          controlSize("large"),
          labelStyle("iconOnly"),
          foregroundStyle(color),
          disabledModifier(disabled),
          accessibilityLabel(label),
        ]}
      />
    </Host>
  );
}
