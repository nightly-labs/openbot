import { Button } from "heroui-native";
import { useCSSVariable } from "uniwind";

import type { ScanQrButtonProps } from "@/features/auth/components/scan-qr-button.types";
import { haptics } from "@/shared/lib/haptics";
import { useText } from "@/shared/lib/text";

export function ScanQrButton({ onPress, width }: ScanQrButtonProps) {
  const { t } = useText();
  const brandColor = String(useCSSVariable("--openbot-logo-production") ?? "#cdadec");
  const labelColor = String(useCSSVariable("--openbot-logo-eye") ?? "#040007");

  const cornerRadius = Number.parseFloat(String(useCSSVariable("--openbot-radius-lg") ?? "12"));

  return (
    <Button
      size="lg"
      variant="primary"
      feedbackVariant="scale"
      className="min-h-13 w-full"
      accessibilityLabel={t("mobile.auth.scanQrCode")}
      style={{ width, backgroundColor: brandColor, borderRadius: cornerRadius }}
      onPress={() => {
        void haptics.impact("light");
        onPress();
      }}
    >
      <Button.Label className="font-sans font-semibold" style={{ color: labelColor }}>
        {t("mobile.auth.scanQrCode")}
      </Button.Label>
    </Button>
  );
}
