import { Typography } from "heroui-native";
import ChevronRight from "lucide-react-native/icons/chevron-right";
import { View } from "react-native";
import { useCSSVariable } from "uniwind";
import { MIRROR_IN_RTL } from "@/shared/lib/text-direction";

/**
 * A value and the disclosure chevron at the end of a navigation row. The value fills the width that
 * the row gives it and truncates only when it does not fit. The chevron has a fixed width at the
 * trailing edge, so the chevrons of all rows have the same position.
 */
export function TrailingValue({ value, tone }: { value: string; tone?: "warning" }) {
  const muted = String(useCSSVariable("--openbot-text-grouped-secondary"));
  return (
    <View className="min-w-0 shrink flex-row items-center justify-end gap-1">
      <Typography.Paragraph
        numberOfLines={1}
        className={tone === "warning" ? "min-w-0 shrink text-warning-text" : "min-w-0 shrink text-grouped-secondary"}
      >
        {value}
      </Typography.Paragraph>
      <View className="w-[18px] shrink-0 items-center">
        <ChevronRight size={18} color={muted} strokeWidth={1.5} style={MIRROR_IN_RTL} />
      </View>
    </View>
  );
}
