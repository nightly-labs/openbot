import { Button } from "heroui-native";
import { useThemeColor } from "heroui-native/hooks";
import { X } from "lucide-react-native";

export interface ScannerCloseButtonProps {
  disabled: boolean;
  onPress: () => void;
}

export function ScannerCloseButton({ disabled, onPress }: ScannerCloseButtonProps) {
  const foreground = useThemeColor("foreground");
  return (
    <Button
      isIconOnly
      variant="secondary"
      className="size-11 rounded-full"
      isDisabled={disabled}
      onPress={onPress}
      accessibilityLabel="Close scanner"
    >
      <X size={20} color={foreground} />
    </Button>
  );
}
