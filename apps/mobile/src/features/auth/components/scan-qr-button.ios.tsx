import { Host } from "@expo/ui";
import { Button, Text } from "@expo/ui/swift-ui";
import {
  accessibilityLabel,
  background,
  buttonStyle,
  font,
  foregroundStyle,
  frame,
  shapes,
} from "@expo/ui/swift-ui/modifiers";
import { useCSSVariable } from "uniwind";

import type { ScanQrButtonProps } from "@/features/auth/components/scan-qr-button.types";

export function ScanQrButton({ onPress, width }: ScanQrButtonProps) {
  const brandColor = String(useCSSVariable("--openbot-logo-production") ?? "#cdadec");
  const labelColor = String(useCSSVariable("--openbot-logo-eye") ?? "#040007");
  const cornerRadius = Number.parseFloat(String(useCSSVariable("--openbot-radius-lg") ?? "12"));

  return (
    <Host ignoreSafeArea="all" seedColor={brandColor} style={{ height: 52, width }}>
      <Button modifiers={[buttonStyle("plain"), accessibilityLabel("Scan QR code")]} onPress={onPress}>
        <Text
          modifiers={[
            font({ textStyle: "body", weight: "semibold" }),
            foregroundStyle(labelColor),
            frame({ width, height: 52 }),
            background(brandColor, shapes.roundedRectangle({ cornerRadius })),
          ]}
        >
          Scan QR code
        </Text>
      </Button>
    </Host>
  );
}
