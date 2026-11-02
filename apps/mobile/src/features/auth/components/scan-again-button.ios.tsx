import { Host } from "@expo/ui";
import { Button } from "@expo/ui/swift-ui";
import { buttonBorderShape, buttonStyle, controlSize, foregroundStyle } from "@expo/ui/swift-ui/modifiers";
import { isLiquidGlassAvailable } from "expo-glass-effect";

import { haptics } from "@/shared/lib/haptics";
import type { ScanAgainButtonProps } from "./scan-again-button";

/** The retry over the camera: a native Liquid Glass capsule, like the close button above it. */
export function ScanAgainButton({ label, onPress }: ScanAgainButtonProps) {
  return (
    <Host matchContents colorScheme="dark">
      <Button
        label={label}
        systemImage="arrow.clockwise"
        onPress={() => {
          void haptics.impact("soft");
          onPress();
        }}
        modifiers={[
          buttonStyle(isLiquidGlassAvailable() ? "glass" : "bordered"),
          buttonBorderShape("capsule"),
          controlSize("large"),
          foregroundStyle("#ffffff"),
        ]}
      />
    </Host>
  );
}
