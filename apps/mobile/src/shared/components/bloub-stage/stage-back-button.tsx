import { Button } from "heroui-native";
import { useThemeColor } from "heroui-native/hooks";
import ChevronLeft from "lucide-react-native/icons/chevron-left";
import X from "lucide-react-native/icons/x";

import { haptics } from "@/shared/lib/haptics";
import { MIRROR_IN_RTL } from "@/shared/lib/text-direction";

export interface StageBackButtonProps {
  icon: "back" | "close";
  label: string;
  color: string;
  disabled?: boolean;
  onPress: () => void;
}

export function StageBackButton({ icon, label, disabled = false, onPress }: StageBackButtonProps) {
  const foreground = String(useThemeColor("foreground"));
  const Icon = icon === "close" ? X : ChevronLeft;
  return (
    <Button
      isIconOnly
      variant="secondary"
      className="size-11 rounded-full"
      isDisabled={disabled}
      accessibilityLabel={label}
      onPress={() => {
        void haptics.impact("soft");
        onPress();
      }}
    >
      <Icon size={20} color={foreground} strokeWidth={2.4} style={icon === "close" ? undefined : MIRROR_IN_RTL} />
    </Button>
  );
}
