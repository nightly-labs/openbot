import { Typography } from "heroui-native";
import ChevronRight from "lucide-react-native/icons/chevron-right";
import { View } from "react-native";
import { useCSSVariable } from "uniwind";
import { MIRROR_IN_RTL } from "@/shared/lib/text-direction";

const TONE_CLASS = {
  warning: "shrink text-warning-text",
  success: "shrink text-success-text",
  danger: "shrink text-danger-text",
} as const;

export function TrailingValue({ value, tone }: { value: string; tone?: keyof typeof TONE_CLASS }) {
  const muted = String(useCSSVariable("--openbot-text-grouped-secondary"));
  return (
    <View className="min-w-0 shrink flex-row items-center gap-1">
      <Typography.Paragraph numberOfLines={1} className={tone ? TONE_CLASS[tone] : "shrink text-grouped-secondary"}>
        {value}
      </Typography.Paragraph>
      <ChevronRight size={18} color={muted} strokeWidth={1.5} style={MIRROR_IN_RTL} />
    </View>
  );
}
