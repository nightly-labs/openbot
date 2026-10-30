import { Button } from "heroui-native";
import { useThemeColor } from "heroui-native/hooks";
import ChevronLeft from "lucide-react-native/icons/chevron-left";
import X from "lucide-react-native/icons/x";

import { haptics } from "@/shared/lib/haptics";

export interface StageBackButtonProps {
  icon: "back" | "close";
  label: string;
  /** The color of the iOS glass label: the eyes on the block, white over the camera. */
  color: string;
  disabled?: boolean;
  onPress: () => void;
}

/**
 * The back or close button on the stage. Android has no Liquid Glass, so it uses a HeroUI icon
 * button with the theme foreground on its own fill.
 */
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
      <Icon size={20} color={foreground} strokeWidth={2.4} />
    </Button>
  );
}
