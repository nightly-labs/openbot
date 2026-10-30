import { Typography } from "heroui-native";
import RotateCw from "lucide-react-native/icons/rotate-cw";
import { Pressable } from "react-native";

import { haptics } from "@/shared/lib/haptics";

export interface ScanAgainButtonProps {
  label: string;
  onPress: () => void;
}

/**
 * The retry over the camera. Android has no Liquid Glass, so it is a light capsule in the style of
 * the status pill above it.
 */
export function ScanAgainButton({ label, onPress }: ScanAgainButtonProps) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      pressRetentionOffset={12}
      onPress={() => {
        void haptics.impact("soft");
        onPress();
      }}
      className="min-h-11 flex-row items-center gap-2 rounded-full px-5"
      style={({ pressed }) => ({
        backgroundColor: "rgba(255,255,255,0.18)",
        borderCurve: "continuous",
        transform: [{ scale: pressed ? 0.97 : 1 }],
      })}
    >
      <RotateCw size={16} color="#ffffff" strokeWidth={2.2} />
      <Typography.Paragraph className="font-semibold text-white">{label}</Typography.Paragraph>
    </Pressable>
  );
}
