import { Host } from "@expo/ui";
import { Button } from "@expo/ui/swift-ui";
import {
  accessibilityLabel,
  bold,
  buttonBorderShape,
  buttonStyle,
  containerRelativeFrame,
  controlSize,
  foregroundStyle,
  frame,
  tint,
} from "@expo/ui/swift-ui/modifiers";
import { useCSSVariable } from "uniwind";

import type { ScanQrButtonProps } from "@/features/auth/components/scan-qr-button.types";

export function ScanQrButton({ onPress }: ScanQrButtonProps) {
  const brandColor = String(useCSSVariable("--openbot-logo-production") ?? "#cdadec");

  const labelColor = String(useCSSVariable("--openbot-logo-eye") ?? "#040007");

  const cornerRadius = Number.parseFloat(String(useCSSVariable("--openbot-radius-lg") ?? "12"));

  return (
    <Host ignoreSafeArea="all" seedColor={brandColor} style={{ height: 52, width: "100%" }} useViewportSizeMeasurement>
      <Button
        label="Scan QR code"
        modifiers={[
          containerRelativeFrame({ axes: "horizontal" }),
          frame({ height: 52 }),
          buttonBorderShape("roundedRectangle", cornerRadius),
          buttonStyle("borderedProminent"),
          controlSize("large"),
          tint(brandColor),
          foregroundStyle(labelColor),
          bold(),
          accessibilityLabel("Scan QR code"),
        ]}
        onPress={onPress}
      />
    </Host>
  );
}
