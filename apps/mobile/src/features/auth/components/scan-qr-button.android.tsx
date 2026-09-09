import { Host } from "@expo/ui";
import { FilledTonalButton, Shape, Text } from "@expo/ui/jetpack-compose";
import { fillMaxWidth, height } from "@expo/ui/jetpack-compose/modifiers";
import { useCSSVariable } from "uniwind";

import type { ScanQrButtonProps } from "@/features/auth/components/scan-qr-button.types";

export function ScanQrButton({ onPress, width }: ScanQrButtonProps) {
  const brandColor = String(useCSSVariable("--openbot-logo-production") ?? "#cdadec");
  const labelColor = String(useCSSVariable("--openbot-logo-eye") ?? "#040007");

  const cornerRadius = Number.parseFloat(String(useCSSVariable("--openbot-radius-lg") ?? "12"));

  return (
    <Host ignoreSafeArea="all" seedColor={brandColor} style={{ height: 52, width }}>
      <FilledTonalButton
        shape={Shape.RoundedCorner({
          cornerRadii: {
            topStart: cornerRadius,
            topEnd: cornerRadius,
            bottomStart: cornerRadius,
            bottomEnd: cornerRadius,
          },
        })}
        colors={{ containerColor: brandColor, contentColor: labelColor }}
        modifiers={[fillMaxWidth(), height(52)]}
        onClick={onPress}
      >
        <Text color={labelColor} style={{ fontSize: 16, fontWeight: "600", typography: "labelLarge" }}>
          Scan QR code
        </Text>
      </FilledTonalButton>
    </Host>
  );
}
