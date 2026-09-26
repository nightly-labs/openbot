import { Button } from "heroui-native";
import { useThemeColor } from "heroui-native/hooks";
import { X } from "lucide-react-native";
import { useText } from "@/shared/lib/text";

export interface ScannerCloseButtonProps {
  disabled: boolean;
  onPress: () => void;
}

export function ScannerCloseButton({ disabled, onPress }: ScannerCloseButtonProps) {
  const { t } = useText();
  const foreground = useThemeColor("foreground");
  return (
    <Button
      isIconOnly
      variant="secondary"
      className="size-11 rounded-full"
      isDisabled={disabled}
      onPress={onPress}
      accessibilityLabel={t("mobile.auth.closeScanner")}
    >
      <X size={20} color={foreground} />
    </Button>
  );
}
